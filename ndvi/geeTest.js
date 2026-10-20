import { access } from 'node:fs/promises';
import path from 'node:path';

const DATASET = 'COPERNICUS/S2_SR_HARMONIZED';
const TEST_WINDOW_DAYS = 90;
const TEST_MAX_CLOUD_PERCENT = 35;
const TEST_SCALE_METERS = 10;
const TEST_THUMB_SIZE = 256;
const TEST_CACHE_TTL_MS = Math.max(
  60_000,
  Number(process.env.GEE_SMOKE_CACHE_TTL_MS || 300_000),
);
const TEST_REGION = Object.freeze([-54.435, -15.335, -54.425, -15.325]);
const NDVI_PALETTE = Object.freeze([
  '8B0000', 'D73027', 'F46D43', 'FDAE61', 'FEE08B',
  'D9EF8B', '66BD63', '1A9850', '006837',
]);

let initialized = false;
let initializing = null;
let smokeResultCache = null;
let smokeTestInFlight = null;

function readGeeCredentials() {
  const rawJson =
    process.env.GEE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    '';
  if (rawJson.trim()) {
    try {
      const parsed = JSON.parse(rawJson);
      return {
        client_email: parsed.client_email,
        private_key: parsed.private_key,
        project_id: parsed.project_id,
      };
    } catch (error) {
      const err = new Error(`GEE_SERVICE_ACCOUNT_JSON inválido: ${error.message}`);
      err.code = 'gee_json_invalid';
      err.status = 500;
      throw err;
    }
  }

  let privateKey = process.env.GEE_PRIVATE_KEY || process.env.GEE_PRIVATE_KEY_B64 || '';
  if (process.env.GEE_PRIVATE_KEY_B64 && !process.env.GEE_PRIVATE_KEY) {
    privateKey = Buffer.from(process.env.GEE_PRIVATE_KEY_B64, 'base64').toString('utf8');
  }

  return {
    client_email: process.env.GEE_CLIENT_EMAIL,
    private_key: privateKey,
    project_id: process.env.GEE_PROJECT_ID,
  };
}

async function loadEarthEngine() {
  try {
    const mod = await import('@google/earthengine');
    return mod.default || mod;
  } catch (error) {
    const err = new Error('@google/earthengine não está instalado ou não pôde ser carregado.');
    err.code = 'gee_sdk_missing';
    err.status = 500;
    err.details = { cause: error.message };
    throw err;
  }
}

function getInfo(eeObject) {
  return new Promise((resolve, reject) => {
    eeObject.getInfo((value, error) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

function getThumbUrl(image, params) {
  return new Promise((resolve, reject) => {
    image.getThumbURL(params, (url, error) => {
      if (error) reject(error);
      else resolve(url);
    });
  });
}

function classifyGeeError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const message = String(error?.message || error || '').toLowerCase();
  if (status === 401 || message.includes('unauthenticated') || message.includes('invalid grant')) {
    return 'gee_authentication_failed';
  }
  if (
    status === 403 ||
    message.includes('permission denied') ||
    message.includes('not registered') ||
    message.includes('not authorized')
  ) {
    return 'gee_authorization_failed';
  }
  if (status === 408 || status === 504 || message.includes('timeout') || message.includes('timed out')) {
    return 'gee_remote_timeout';
  }
  return 'gee_auth_failed';
}

async function ensureGeeInitialized(ee) {
  if (initialized) return true;
  if (initializing) return initializing;

  const credentials = readGeeCredentials();
  const clientEmail = String(credentials.client_email || '').trim();
  const privateKey = String(credentials.private_key || '').replace(/\\n/g, '\n').trim();
  const projectId = String(credentials.project_id || process.env.GEE_PROJECT_ID || '').trim();

  if (!clientEmail || !privateKey) {
    const err = new Error(
      'Credenciais GEE ausentes: configure GEE_SERVICE_ACCOUNT_JSON ou GEE_CLIENT_EMAIL/GEE_PRIVATE_KEY.',
    );
    err.code = 'gee_not_configured';
    err.status = 503;
    throw err;
  }

  initializing = new Promise((resolve, reject) => {
    ee.data.authenticateViaPrivateKey(
      { client_email: clientEmail, private_key: privateKey },
      () => {
        if (projectId && ee.data.setCloudApiUserProject) {
          ee.data.setCloudApiUserProject(projectId);
        }
        ee.initialize(
          null,
          null,
          () => {
            initialized = true;
            resolve(true);
          },
          (error) => reject(error),
        );
      },
      (error) => reject(error),
    );
  }).catch((error) => {
    initializing = null;
    const err = new Error(error?.message || String(error || 'Falha ao inicializar GEE'));
    err.code = classifyGeeError(error);
    err.status = err.code === 'gee_authorization_failed' ? 403 : 502;
    throw err;
  });

  return initializing;
}

async function geeEngineExists() {
  try {
    await access(path.join(process.cwd(), 'ndvi', 'gee', 'geeNdviEngine.js'));
    return true;
  } catch {
    return false;
  }
}

function createStageTimer() {
  const startedAt = Date.now();
  const stages = {};
  return {
    async measure(name, work) {
      const stageStartedAt = Date.now();
      try {
        return await work();
      } catch (error) {
        if (!error.code) error.code = `gee_${name}_failed`;
        error.stage = name;
        throw error;
      } finally {
        stages[name] = Date.now() - stageStartedAt;
      }
    },
    snapshot() {
      return { ...stages, total: Date.now() - startedAt };
    },
  };
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateGeeNdviStats(stats) {
  const mean = finiteNumber(stats?.NDVI_mean);
  const min = finiteNumber(stats?.NDVI_min);
  const max = finiteNumber(stats?.NDVI_max);
  const validPixelCount = finiteNumber(stats?.NDVI_count);
  return {
    valid:
      mean !== null &&
      min !== null &&
      max !== null &&
      validPixelCount !== null &&
      validPixelCount > 0 &&
      min >= -1 &&
      max <= 1 &&
      min <= mean &&
      mean <= max,
    mean,
    min,
    max,
    validPixelCount,
  };
}

function buildSclMask(image) {
  const scl = image.select('SCL');
  return scl
    .neq(0)
    .and(scl.neq(1))
    .and(scl.neq(3))
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));
}

async function verifyThumbnail(url, fetchImpl) {
  if (!url || typeof url !== 'string') {
    const err = new Error('GEE não retornou uma URL de visualização.');
    err.code = 'gee_thumbnail_url_missing';
    err.status = 502;
    throw err;
  }

  const response = await fetchImpl(url, {
    method: 'GET',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const err = new Error(`A visualização GEE respondeu HTTP ${response.status}.`);
    err.code = 'gee_thumbnail_unreachable';
    err.status = 502;
    throw err;
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const bytes = (await response.arrayBuffer()).byteLength;
  if (!contentType.startsWith('image/') || bytes <= 0) {
    const err = new Error('A visualização GEE não retornou uma imagem válida.');
    err.code = 'gee_thumbnail_invalid';
    err.status = 502;
    throw err;
  }

  return { reachable: true, content_type: contentType, bytes };
}

async function executeGeeSmokeTest({ fetchImpl = globalThis.fetch } = {}) {
  const timer = createStageTimer();
  const engineExists = await geeEngineExists();
  try {
    const ee = await timer.measure('sdk_load', loadEarthEngine);
    await timer.measure('authentication_initialization', () => ensureGeeInitialized(ee));

    const region = ee.Geometry.Rectangle(TEST_REGION, null, false);
    const end = ee.Date(Date.now());
    const start = end.advance(-TEST_WINDOW_DAYS, 'day');
    const collection = ee
      .ImageCollection(DATASET)
      .filterBounds(region)
      .filterDate(start, end)
      .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', TEST_MAX_CLOUD_PERCENT))
      .sort('CLOUDY_PIXEL_PERCENTAGE');
    const image = ee.Image(collection.first());

    const metadata = await timer.measure('sentinel_query', () =>
      getInfo(
        image.toDictionary([
          'system:index',
          'system:time_start',
          'CLOUDY_PIXEL_PERCENTAGE',
        ]),
      ),
    );
    if (!metadata?.['system:index']) {
      const err = new Error('Nenhuma cena Sentinel-2 válida encontrada para o teste mínimo.');
      err.code = 'gee_scene_not_found';
      err.status = 404;
      throw err;
    }

    const ndvi = await timer.measure('cloud_mask_ndvi_definition', async () =>
      image
        .updateMask(buildSclMask(image))
        .normalizedDifference(['B8', 'B4'])
        .rename('NDVI')
        .clip(region),
    );
    const rawStats = await timer.measure('ndvi_statistics', () =>
      getInfo(
        ndvi.reduceRegion({
          reducer: ee.Reducer.mean()
            .combine({ reducer2: ee.Reducer.minMax(), sharedInputs: true })
            .combine({ reducer2: ee.Reducer.count(), sharedInputs: true }),
          geometry: region,
          scale: TEST_SCALE_METERS,
          bestEffort: true,
          maxPixels: 1_000_000,
          tileScale: 2,
        }),
      ),
    );
    const stats = validateGeeNdviStats(rawStats);
    if (!stats.valid) {
      const err = new Error('O GEE respondeu, mas não produziu estatísticas NDVI válidas.');
      err.code = 'gee_ndvi_invalid';
      err.status = 422;
      err.details = {
        has_mean: stats.mean !== null,
        has_min: stats.min !== null,
        has_max: stats.max !== null,
        valid_pixel_count: stats.validPixelCount,
      };
      throw err;
    }

    const thumbnailUrl = await timer.measure('thumbnail_url', () =>
      getThumbUrl(ndvi, {
        region,
        dimensions: TEST_THUMB_SIZE,
        format: 'png',
        min: -0.2,
        max: 0.9,
        palette: NDVI_PALETTE,
      }),
    );
    const thumbnail = await timer.measure('thumbnail_download', () =>
      verifyThumbnail(thumbnailUrl, fetchImpl),
    );

    return {
      success: true,
      gee: true,
      provider: 'google_earth_engine',
      dataset: DATASET,
      algorithm: 'normalized_difference_b8_b4',
      cloud_mask: 'sentinel_2_scl_v1',
      image: metadata['system:index'],
      image_time_ms: finiteNumber(metadata['system:time_start']),
      scene_cloud_percent: finiteNumber(metadata.CLOUDY_PIXEL_PERCENTAGE),
      ndvi: {
        mean: stats.mean,
        min: stats.min,
        max: stats.max,
        valid_pixel_count: stats.validPixelCount,
      },
      thumbnail,
      gee_engine_exists: engineExists,
      gee_engine_loaded: true,
      project_configured: Boolean(String(process.env.GEE_PROJECT_ID || '').trim()),
      timings_ms: timer.snapshot(),
    };
  } catch (error) {
    error.details = {
      ...(error.details || {}),
      stage: error.stage || 'unknown',
      timings_ms: timer.snapshot(),
    };
    throw error;
  }
}

export async function runGeeSmokeTest({
  fetchImpl = globalThis.fetch,
  force = false,
} = {}) {
  const now = Date.now();
  if (
    !force &&
    smokeResultCache &&
    now - smokeResultCache.createdAt < TEST_CACHE_TTL_MS
  ) {
    return {
      ...smokeResultCache.result,
      cached: true,
      cache_age_ms: now - smokeResultCache.createdAt,
    };
  }
  if (!force && smokeTestInFlight) return smokeTestInFlight;

  const run = executeGeeSmokeTest({ fetchImpl }).then((result) => {
    smokeResultCache = { createdAt: Date.now(), result };
    return { ...result, cached: false };
  });
  smokeTestInFlight = run;
  try {
    return await run;
  } finally {
    if (smokeTestInFlight === run) smokeTestInFlight = null;
  }
}

export async function geeSmokeFailurePayload(error) {
  const code = String(error?.code || 'gee_test_failed');
  const details = error?.details || {};
  return {
    success: false,
    gee: false,
    code: /^gee_[a-z0-9_]+$/.test(code) ? code : 'gee_test_failed',
    message: 'O teste GEE falhou; consulte o código e a etapa para diagnóstico.',
    gee_engine_exists: await geeEngineExists(),
    gee_engine_loaded: initialized,
    details: {
      stage: String(details.stage || 'unknown'),
      timings_ms: details.timings_ms || {},
      ...(Number.isFinite(details.valid_pixel_count)
        ? { valid_pixel_count: details.valid_pixel_count }
        : {}),
    },
  };
}
