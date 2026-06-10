import { storeNdviPreviewPng } from '../ndviPreviewStorage.js';
import { NDVI_ENGINE_VERSION } from '../sentinelNdviReliability.js';

const DATASET = 'COPERNICUS/S2_SR_HARMONIZED';
const DEFAULT_MAX_CLOUD = 35;
const GEE_RENDER_SCALE_M = 10;
const DEFAULT_THUMB_SIZE = 2048;
const DEFAULT_INNER_BUFFER_M = 10;
const DEFAULT_SMOOTHING_RADIUS_PX = 1;

const VISUAL_MODES = Object.freeze({
  NDVI_ABSOLUTE: 'ndvi_absolute',
  NDVI_CONTRAST: 'ndvi_contrast',
  NDVI_RELATIVE: 'ndvi_relative',
  AGRONOMIC_CLASSES: 'agronomic_classes',
  NDRE: 'ndre',
  SAVI: 'savi',
  BSI_SOIL: 'bsi_soil',
  NDMI_WATER_STRESS: 'ndmi_water_stress',
});

const NDVI_AGRONOMIC_PALETTE = [
  '8B0000',
  'D73027',
  'F46D43',
  'FDAE61',
  'FEE08B',
  'D9EF8B',
  'A6D96A',
  '66BD63',
  '1A9850',
  '006837',
];
const SOIL_PALETTE = ['C49A6C', 'D8C18A', '8BC34A', '2E7D32'];
const WATER_STRESS_PALETTE = ['8D1B1B', 'E65100', 'F9A825', '66BB6A', '81D4FA', '0D47A1'];

let initialized = false;
let initializing = null;
let ee = null;

function visualModes() {
  return Object.values(VISUAL_MODES);
}

function rendererVersionFor(mode) {
  switch (mode) {
    case VISUAL_MODES.NDVI_CONTRAST:
      return NDVI_ENGINE_VERSION;
    case VISUAL_MODES.NDVI_RELATIVE:
      return 'ndvi_relative_v2_gee_10m';
    case VISUAL_MODES.AGRONOMIC_CLASSES:
      return 'agronomic_classes_v2_gee_10m';
    case VISUAL_MODES.NDRE:
      return 'ndre_v2_gee_10m';
    case VISUAL_MODES.SAVI:
      return 'savi_v2_gee_10m';
    case VISUAL_MODES.BSI_SOIL:
      return 'bsi_soil_v2_gee_10m';
    case VISUAL_MODES.NDMI_WATER_STRESS:
      return 'ndmi_water_stress_v2_gee_10m';
    case VISUAL_MODES.NDVI_ABSOLUTE:
    default:
      return 'ndvi_absolute_v2_gee_10m';
  }
}

function readGeeCredentials() {
  const rawJson =
    process.env.GEE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    '';
  if (rawJson.trim()) {
    const parsed = JSON.parse(rawJson);
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
      project_id: parsed.project_id,
    };
  }

  let privateKey =
    process.env.GEE_PRIVATE_KEY ||
    process.env.GEE_PRIVATE_KEY_B64 ||
    '';
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
  if (ee) return ee;
  const mod = await import('@google/earthengine');
  ee = mod.default || mod;
  return ee;
}

async function ensureGeeInitialized() {
  const gee = await loadEarthEngine();
  if (initialized) return gee;
  if (initializing) {
    await initializing;
    return gee;
  }

  const credentials = readGeeCredentials();
  const clientEmail = String(credentials.client_email || '').trim();
  const privateKey = String(credentials.private_key || '').replace(/\\n/g, '\n').trim();
  const projectId = String(credentials.project_id || process.env.GEE_PROJECT_ID || '').trim();
  if (!clientEmail || !privateKey) {
    const err = new Error('Credenciais GEE ausentes.');
    err.code = 'gee_not_configured';
    err.status = 503;
    throw err;
  }

  initializing = new Promise((resolve, reject) => {
    gee.data.authenticateViaPrivateKey(
      { client_email: clientEmail, private_key: privateKey },
      () => {
        if (projectId && gee.data.setCloudApiUserProject) {
          gee.data.setCloudApiUserProject(projectId);
        }
        gee.initialize(
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
    err.code = 'gee_auth_failed';
    err.status = 502;
    throw err;
  });

  await initializing;
  return gee;
}

function getInfo(eeObject) {
  return new Promise((resolve, reject) => {
    eeObject.getInfo((value, error) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

function polygonToBounds(polygon) {
  const coords = polygon?.coordinates?.[0];
  if (!Array.isArray(coords) || !coords.length) return null;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const point of coords) {
    const lon = Number(point?.[0]);
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (![west, south, east, north].every(Number.isFinite)) return null;
  return { west, south, east, north };
}

function mapGeeScene({ sceneId, imageDate, cloudCoverage }) {
  return {
    scene_id: sceneId,
    id: sceneId,
    image_date: imageDate,
    source: 'gee_sentinel_2_l2a',
    provider: 'google_earth_engine',
    provider_used: 'google_earth_engine',
    processing_engine: 'google_earth_engine',
    cloud_coverage: cloudCoverage == null ? null : Number(cloudCoverage),
    resolution_m: 10,
    preview_url: null,
    status: 'available',
  };
}

function exclusiveEndDate(value) {
  if (!value) return value;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function homogeneityLabel(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 75) return 'uniforme';
  if (n >= 45) return 'moderado';
  return 'heterogêneo';
}

function homogeneityScore({ std, p5, p95 }) {
  const spread = Number(p95) - Number(p5);
  if (!Number.isFinite(std) || !Number.isFinite(spread)) return null;
  const stdPenalty = Math.min(55, Math.max(0, std / 0.004));
  const spreadPenalty = Math.min(45, Math.max(0, spread / 0.0045));
  return Math.max(0, Math.min(100, Math.round(100 - stdPenalty - spreadPenalty)));
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function innerBufferedGeometry(geometry) {
  const bufferM = numberFromEnv('GEE_INNER_BUFFER_M', DEFAULT_INNER_BUFFER_M);
  if (!Number.isFinite(bufferM) || bufferM <= 0) return geometry;
  return geometry.buffer(-Math.abs(bufferM));
}

async function safeStatsGeometry(gee, geometry) {
  const bufferM = numberFromEnv('GEE_INNER_BUFFER_M', DEFAULT_INNER_BUFFER_M);
  let fullAreaHa = null;
  if (!Number.isFinite(bufferM) || bufferM <= 0) {
    try {
      fullAreaHa = Number(await getInfo(geometry.area(1))) / 10000;
    } catch (_) {}
    return { geometry, bufferAppliedM: 0, fullAreaHa };
  }

  const candidate = innerBufferedGeometry(geometry);
  try {
    const areas = await getInfo(
      gee.Dictionary({
        full: geometry.area(1),
        buffered: candidate.area(1),
      }),
    );
    const fullArea = Number(areas?.full);
    const bufferedArea = Number(areas?.buffered);
    fullAreaHa = Number.isFinite(fullArea) ? fullArea / 10000 : null;
    if (
      Number.isFinite(fullArea) &&
      Number.isFinite(bufferedArea) &&
      fullArea > 0 &&
      bufferedArea > fullArea * 0.25
    ) {
      return { geometry: candidate, bufferAppliedM: bufferM, fullAreaHa };
    }
  } catch (error) {
    console.warn('[NDVI_GEE_BUFFER_FALLBACK]', {
      bufferM,
      message: error?.message || String(error),
    });
  }
  return { geometry, bufferAppliedM: 0, fullAreaHa };
}

function maskIndexToGeometry(gee, image, geometry, bandName) {
  const plotMask = gee.Image.constant(1).clip(geometry).selfMask();
  return image.updateMask(plotMask).clip(geometry).rename(bandName);
}

function smoothForPreview(image, geometry) {
  const radius = numberFromEnv('GEE_SMOOTHING_RADIUS_PX', DEFAULT_SMOOTHING_RADIUS_PX);
  const resampled = image.resample('bicubic');
  if (!Number.isFinite(radius) || radius <= 0) {
    return resampled.updateMask(image.mask()).clip(geometry);
  }
  return resampled
    .focal_median(radius, 'circle', 'pixels')
    .updateMask(image.mask())
    .clip(geometry);
}

function roundOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(4)) : null;
}

function percent(value, totalArea) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || !Number.isFinite(totalArea) || totalArea <= 0) {
    return null;
  }
  return Number(((number / totalArea) * 100).toFixed(2));
}

function geometryFromPolygon(gee, polygon) {
  if (!polygon || polygon.type !== 'Polygon' || !Array.isArray(polygon.coordinates)) {
    const err = new Error('Polígono inválido para Google Earth Engine');
    err.code = 'plot_polygon_missing';
    err.status = 400;
    throw err;
  }
  return gee.Geometry.Polygon(polygon.coordinates);
}

function buildSclValidMask(image) {
  const scl = image.select('SCL');
  return scl
    .neq(0)
    .and(scl.neq(1))
    .and(scl.neq(3))
    .and(scl.neq(6))
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));
}

function maskClouds(image) {
  return image.updateMask(buildSclValidMask(image));
}

function buildNdviValidMask(gee, { image, ndvi, geometry }) {
  const b4 = image.select('B4');
  const b8 = image.select('B8');
  const plotMask = gee.Image.constant(1).clip(geometry).selfMask();
  const bandMask = b4
    .mask()
    .and(b8.mask())
    .and(b4.gt(0))
    .and(b8.gt(0));
  const ndviMask = ndvi.gte(-1).and(ndvi.lte(1));
  return buildSclValidMask(image)
    .and(bandMask)
    .and(ndviMask)
    .updateMask(plotMask)
    .clip(geometry);
}

function buildIndexValidMask(gee, { image, index, geometry, bands }) {
  const plotMask = gee.Image.constant(1).clip(geometry).selfMask();
  const bandMask = bands
    .map((band) => image.select(band))
    .reduce((mask, bandImage) =>
      mask
        .and(bandImage.mask())
        .and(bandImage.gt(0)),
    gee.Image.constant(1));
  const indexMask = index.gte(-1).and(index.lte(1));
  return buildSclValidMask(image)
    .and(bandMask)
    .and(indexMask)
    .updateMask(plotMask)
    .clip(geometry);
}

async function calculateGeeMaskStats(gee, { image, validMask, geometry }) {
  const one = gee.Image.constant(1);
  const sclExcludedMask = buildSclValidMask(image).not();
  const counts = await getInfo(
    gee.Image.cat([
      one.rename('total'),
      one.updateMask(validMask).rename('valid'),
      one.updateMask(sclExcludedMask).rename('scl_excluded'),
    ]).reduceRegion({
      reducer: gee.Reducer.count(),
      geometry,
      scale: GEE_RENDER_SCALE_M,
      maxPixels: 1e9,
      bestEffort: true,
    }),
  );
  const totalPixels = Number(counts?.total || 0);
  const validPixels = Number(counts?.valid || 0);
  const sclExcludedPixels = Number(counts?.scl_excluded || 0);
  return {
    totalPixels,
    validPixels,
    maskedPixels: Math.max(0, totalPixels - validPixels),
    sclExcludedPixels,
  };
}

function sentinelCollection(gee, { geometry, startDate, endDate, maxCloud }) {
  const cloudLimit = Number(maxCloud ?? process.env.GEE_MAX_CLOUD ?? DEFAULT_MAX_CLOUD);
  return gee
    .ImageCollection(DATASET)
    .filterBounds(geometry)
    .filterDate(startDate, exclusiveEndDate(endDate))
    .filter(gee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloudLimit))
    .sort('CLOUDY_PIXEL_PERCENTAGE')
    .sort('system:time_start', false);
}

function buildClassAreaImage(gee, ndvi) {
  const pixelArea = gee.Image.pixelArea();
  const veryLow = ndvi.gte(0).and(ndvi.lt(0.3));
  const low = ndvi.gte(0.3).and(ndvi.lt(0.5));
  const medium = ndvi.gte(0.5).and(ndvi.lt(0.8));
  const high = ndvi.gte(0.8).and(ndvi.lte(1.0));
  return gee.Image.cat([
    pixelArea.updateMask(veryLow).rename('very_low'),
    pixelArea.updateMask(low).rename('low'),
    pixelArea.updateMask(medium).rename('medium'),
    pixelArea.updateMask(high).rename('high'),
  ]);
}

async function calculateSingleIndexStats(gee, { image, bandName, geometry }) {
  if (!image) return {};
  const stats = await getInfo(
    image.rename(bandName).reduceRegion({
      reducer: gee
        .Reducer.mean()
        .combine(gee.Reducer.minMax(), '', true)
        .combine(gee.Reducer.percentile([5, 25, 50, 75, 95]), '', true),
      geometry,
      scale: GEE_RENDER_SCALE_M,
      maxPixels: 1e9,
      bestEffort: true,
    }),
  );
  return {
    mean: roundOrNull(stats[`${bandName}_mean`] ?? stats[bandName]),
    min: roundOrNull(stats[`${bandName}_min`]),
    max: roundOrNull(stats[`${bandName}_max`]),
    p5: roundOrNull(stats[`${bandName}_p5`]),
    p25: roundOrNull(stats[`${bandName}_p25`]),
    p50: roundOrNull(stats[`${bandName}_p50`]),
    p75: roundOrNull(stats[`${bandName}_p75`]),
    p95: roundOrNull(stats[`${bandName}_p95`]),
  };
}

async function calculateThresholdPercents(gee, { baseImage, bands, geometry }) {
  const entries = Object.entries(bands).filter(([, image]) => image);
  if (!entries.length) return {};
  const areas = await getInfo(
    gee.Image.cat([
      gee.Image.pixelArea().updateMask(baseImage.mask()).rename('total'),
      ...entries.map(([name, image]) => gee.Image.pixelArea().updateMask(image).rename(name)),
    ]).reduceRegion({
      reducer: gee.Reducer.sum(),
      geometry,
      scale: GEE_RENDER_SCALE_M,
      maxPixels: 1e9,
      bestEffort: true,
    }),
  );
  const total = Number(areas?.total || 0);
  return Object.fromEntries(
    entries.map(([key]) => [key, percent(areas?.[key], total)]),
  );
}

async function calculateIndexStats(gee, { ndre, savi, bsi, ndmi, geometry }) {
  const [ndreStats, saviStats, bsiStats, ndmiStats] = await Promise.all([
    calculateSingleIndexStats(gee, { image: ndre, bandName: 'NDRE', geometry }),
    calculateSingleIndexStats(gee, { image: savi, bandName: 'SAVI', geometry }),
    calculateSingleIndexStats(gee, { image: bsi, bandName: 'BSI', geometry }),
    calculateSingleIndexStats(gee, { image: ndmi, bandName: 'NDMI', geometry }),
  ]);
  const [moistureBuckets, chlorophyllBuckets] = await Promise.all([
    ndmi
      ? calculateThresholdPercents(gee, {
          geometry,
          baseImage: ndmi,
          bands: {
            waterStressPercent: ndmi.lt(0.1),
            adequateMoisturePercent: ndmi.gte(0.2).and(ndmi.lt(0.45)),
            highMoisturePercent: ndmi.gte(0.45),
          },
        })
      : {},
    ndre && Number.isFinite(ndreStats.p25) && Number.isFinite(ndreStats.p75)
      ? calculateThresholdPercents(gee, {
          geometry,
          baseImage: ndre,
          bands: {
            lowChlorophyllPercent: ndre.lte(ndreStats.p25),
            highChlorophyllPercent: ndre.gte(ndreStats.p75),
          },
        })
      : {},
  ]);
  return {
    ndre_mean: ndreStats.mean,
    ndre_min: ndreStats.min,
    ndre_max: ndreStats.max,
    ndre_p5: ndreStats.p5,
    ndre_p25: ndreStats.p25,
    ndre_p50: ndreStats.p50,
    ndre_p75: ndreStats.p75,
    ndre_p95: ndreStats.p95,
    lowChlorophyllPercent: chlorophyllBuckets.lowChlorophyllPercent,
    highChlorophyllPercent: chlorophyllBuckets.highChlorophyllPercent,
    savi_mean: saviStats.mean,
    savi_min: saviStats.min,
    savi_max: saviStats.max,
    savi_p5: saviStats.p5,
    savi_p50: saviStats.p50,
    savi_p95: saviStats.p95,
    bsi_mean: bsiStats.mean,
    bsi_min: bsiStats.min,
    bsi_max: bsiStats.max,
    bsi_p5: bsiStats.p5,
    bsi_p50: bsiStats.p50,
    bsi_p95: bsiStats.p95,
    ndmi_mean: ndmiStats.mean,
    ndmi_min: ndmiStats.min,
    ndmi_max: ndmiStats.max,
    ndmi_p5: ndmiStats.p5,
    ndmi_p50: ndmiStats.p50,
    ndmi_p95: ndmiStats.p95,
    waterStressPercent: moistureBuckets.waterStressPercent,
    adequateMoisturePercent: moistureBuckets.adequateMoisturePercent,
    highMoisturePercent: moistureBuckets.highMoisturePercent,
  };
}

async function calculateGeeNdviStats(gee, { ndvi, ndre, savi, bsi, ndmi, geometry }) {
  const basicStats = await getInfo(
    ndvi.reduceRegion({
      reducer: gee
        .Reducer.mean()
        .combine(gee.Reducer.minMax(), '', true)
        .combine(gee.Reducer.stdDev(), '', true)
        .combine(gee.Reducer.percentile([2, 5, 10, 25, 50, 75, 90, 95, 98]), '', true),
      geometry,
      scale: GEE_RENDER_SCALE_M,
      maxPixels: 1e9,
      bestEffort: true,
    }),
  );
  const classStats = await getInfo(
    buildClassAreaImage(gee, ndvi).reduceRegion({
      reducer: gee.Reducer.sum(),
      geometry,
      scale: GEE_RENDER_SCALE_M,
      maxPixels: 1e9,
      bestEffort: true,
    }),
  );

  const totalArea =
    Number(classStats.very_low || 0) +
    Number(classStats.low || 0) +
    Number(classStats.medium || 0) +
    Number(classStats.high || 0);
  const ndviStd = roundOrNull(basicStats.NDVI_stdDev);
  const p2 = roundOrNull(basicStats.NDVI_p2);
  const p5 = roundOrNull(basicStats.NDVI_p5);
  const p95 = roundOrNull(basicStats.NDVI_p95);
  const p98 = roundOrNull(basicStats.NDVI_p98);
  const homogeneity = homogeneityScore({ std: ndviStd, p5, p95 });
  const indexStats = await calculateIndexStats(gee, { ndre, savi, bsi, ndmi, geometry });

  return {
    ndvi_mean: roundOrNull(basicStats.NDVI_mean ?? basicStats.NDVI),
    ndvi_min: roundOrNull(basicStats.NDVI_min),
    ndvi_max: roundOrNull(basicStats.NDVI_max),
    ndvi_std: ndviStd,
    ndvi_p2: p2,
    ndvi_p5: p5,
    ndvi_p10: roundOrNull(basicStats.NDVI_p10),
    ndvi_p25: roundOrNull(basicStats.NDVI_p25),
    ndvi_p50: roundOrNull(basicStats.NDVI_p50),
    ndvi_p75: roundOrNull(basicStats.NDVI_p75),
    ndvi_p90: roundOrNull(basicStats.NDVI_p90),
    ndvi_p95: p95,
    ndvi_p98: p98,
    homogeneity_score: homogeneity,
    homogeneity_label: homogeneityLabel(homogeneity),
    very_low_percent: percent(classStats.very_low, totalArea),
    low_percent: percent(classStats.low, totalArea),
    medium_percent: percent(classStats.medium, totalArea),
    high_percent: percent(classStats.high, totalArea),
    contrast: {
      p2,
      p5,
      p10: roundOrNull(basicStats.NDVI_p10),
      p25: roundOrNull(basicStats.NDVI_p25),
      p50: roundOrNull(basicStats.NDVI_p50),
      p75: roundOrNull(basicStats.NDVI_p75),
      p90: roundOrNull(basicStats.NDVI_p90),
      p95,
      p98,
      min: roundOrNull(basicStats.NDVI_min),
      max: roundOrNull(basicStats.NDVI_max),
      std: ndviStd,
      homogeneity,
    },
    ...indexStats,
    classes: {
      veryLowPercent: percent(classStats.very_low, totalArea),
      lowVigorPercent: percent(classStats.low, totalArea),
      mediumVigorPercent: percent(classStats.medium, totalArea),
      highVigorPercent: percent(classStats.high, totalArea),
    },
  };
}

function resolveIndexImage({ mode, ndvi, ndre, savi, bsi, ndmi }) {
  switch (mode) {
    case VISUAL_MODES.NDRE:
      return ndre || ndvi;
    case VISUAL_MODES.SAVI:
      return savi || ndvi;
    case VISUAL_MODES.BSI_SOIL:
      return bsi || ndvi;
    case VISUAL_MODES.NDMI_WATER_STRESS:
      return ndmi || ndvi;
    default:
      return ndvi;
  }
}

function resolveContrastStretch(stats = {}) {
  const p2 = Number(stats.ndvi_p2 ?? stats.contrast?.p2);
  const p98 = Number(stats.ndvi_p98 ?? stats.contrast?.p98);
  const p5 = Number(stats.ndvi_p5 ?? stats.contrast?.p5);
  const p95 = Number(stats.ndvi_p95 ?? stats.contrast?.p95);
  const p50 = Number(stats.ndvi_p50 ?? stats.contrast?.p50);
  const std = Number(stats.ndvi_std ?? stats.contrast?.std);

  // Para talhões muito verdes, p2/p98 pode capturar borda/solo/estrada e
  // abrir demais a escala, deixando tudo verde. O contraste agronômico deve
  // priorizar a faixa robusta p5/p95 quando ela já tem amplitude útil.
  if (Number.isFinite(p5) && Number.isFinite(p95) && p95 > p5) {
    const robustRange = p95 - p5;
    if (
      robustRange < 0.03 &&
      Number.isFinite(p2) &&
      Number.isFinite(p98) &&
      p98 > p2
    ) {
      return {
        min: p2,
        max: p98,
        gamma: 0.85,
        lowContrastScene: true,
        stretchMode: 'low_contrast_p2_p98_gamma',
      };
    }
    if (robustRange >= 0.03) {
      return {
        min: p5,
        max: p95,
        gamma: 1,
        lowContrastScene: false,
        stretchMode: 'p5_p95_robust',
      };
    }
  }

  if (Number.isFinite(p2) && Number.isFinite(p98) && p98 > p2) {
    const range = p98 - p2;
    const p2LooksLikeOutlier =
      Number.isFinite(p5) && Number.isFinite(p50) && p5 - p2 > Math.max(0.05, (p50 - p5) * 2.5);
    const p98LooksLikeOutlier =
      Number.isFinite(p95) && Number.isFinite(p50) && p98 - p95 > Math.max(0.05, (p95 - p50) * 2.5);
    if (
      range >= 0.035 &&
      !p2LooksLikeOutlier &&
      !p98LooksLikeOutlier
    ) {
      return {
        min: p2,
        max: p98,
        gamma: 1,
        lowContrastScene: false,
        stretchMode: 'p2_p98',
      };
    }
  }

  if (Number.isFinite(p50) && Number.isFinite(std) && std > 0) {
    return {
      min: Math.max(-1, p50 - 2 * std),
      max: Math.min(1, p50 + 2 * std),
      gamma: 1,
      lowContrastScene: false,
      stretchMode: 'std_2sigma',
    };
  }

  return {
    min: Number.isFinite(p5) ? p5 : 0,
    max: Number.isFinite(p95) && p95 > p5 ? p95 : 1,
    gamma: 1,
    lowContrastScene: false,
    stretchMode: 'p5_p95',
  };
}

function visualizationFor({ mode = VISUAL_MODES.NDVI_CONTRAST, stats = {} } = {}) {
  if (mode === VISUAL_MODES.NDVI_CONTRAST) {
    const stretch = resolveContrastStretch(stats);
    return {
      min: stretch.min,
      max: stretch.max,
      gamma: stretch.gamma,
      palette: NDVI_AGRONOMIC_PALETTE,
      forceRgbOutput: true,
    };
  }
  if (mode === VISUAL_MODES.BSI_SOIL) {
    return { min: -0.25, max: 0.45, palette: SOIL_PALETTE, forceRgbOutput: true };
  }
  if (mode === VISUAL_MODES.NDMI_WATER_STRESS) {
    return {
      min: Number(stats.ndmi_p5 ?? -0.15),
      max: Number(stats.ndmi_p95 ?? 0.55),
      palette: WATER_STRESS_PALETTE,
      forceRgbOutput: true,
    };
  }
  if (mode === VISUAL_MODES.NDRE) {
    return {
      min: Number(stats.ndre_p5 ?? 0),
      max: Number(stats.ndre_p95 ?? 0.6),
      palette: NDVI_AGRONOMIC_PALETTE,
      forceRgbOutput: true,
    };
  }
  return {
    min: mode === VISUAL_MODES.NDVI_ABSOLUTE ? 0 : Number(stats.ndvi_min ?? 0),
    max: mode === VISUAL_MODES.NDVI_ABSOLUTE ? 1 : Number(stats.ndvi_max ?? 1),
    palette: NDVI_AGRONOMIC_PALETTE,
    forceRgbOutput: true,
  };
}

async function downloadPng(url, fetchImpl) {
  const response = await fetchImpl(url, {
    method: 'GET',
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) {
    const err = new Error(`GEE thumbnail falhou com status ${response.status}`);
    err.code = 'GEE_THUMB_ERROR';
    err.status = 502;
    throw err;
  }
  return Buffer.from(await response.arrayBuffer());
}

function preferredThumbSize(areaHa) {
  const configured = numberFromEnv('GEE_THUMB_SIZE', NaN);
  if (Number.isFinite(configured) && configured >= 2048) return Math.round(configured);
  const area = Number(areaHa);
  if (Number.isFinite(area) && area > 1000) return 4096;
  if (Number.isFinite(area) && area > 500) return 3072;
  return DEFAULT_THUMB_SIZE;
}

function thumbnailSizes(areaHa) {
  const configured = numberFromEnv('GEE_THUMB_SIZE', NaN);
  const preferred = preferredThumbSize(areaHa);
  const fallbacks = preferred >= 4096
    ? [4096, 3072, DEFAULT_THUMB_SIZE, 1536]
    : preferred >= 3072
      ? [3072, DEFAULT_THUMB_SIZE, 1536]
      : [DEFAULT_THUMB_SIZE, 1536];
  return [...new Set([configured, preferred, ...fallbacks])]
    .filter((size) => Number.isFinite(size) && size > 0)
    .map((size) => Math.round(size));
}

async function renderVisualPngWithFallback({
  image,
  fallbackImage,
  stats,
  mode,
  geometry,
  areaHa,
  fetchImpl,
}) {
  let lastError = null;
  const candidates = [
    { image, smoothingApplied: true },
    fallbackImage ? { image: fallbackImage, smoothingApplied: false } : null,
  ].filter(Boolean);
  for (const candidate of candidates) {
    for (const size of thumbnailSizes(areaHa)) {
      try {
        const visual = candidate.image
          .visualize(visualizationFor({ mode, stats }))
          .updateMask(candidate.image.mask())
          .clip(geometry);
        const thumbUrl = visual.getThumbURL({
          // Mantém o mesmo bbox geográfico do overlay; o buffer interno aparece
          // como transparência dentro desse bbox, sem esticar a imagem.
          region: geometry,
          dimensions: size,
          format: 'png',
        });
        return {
          buffer: await downloadPng(thumbUrl, fetchImpl),
          thumbSize: size,
          smoothingApplied: candidate.smoothingApplied,
        };
      } catch (error) {
        lastError = error;
        console.warn('[NDVI_GEE_THUMB_FALLBACK]', {
          size,
          smoothingApplied: candidate.smoothingApplied,
          message: error?.message || String(error),
        });
      }
    }
  }
  throw lastError || new Error('Falha ao gerar thumbnail GEE');
}

export async function createGeeNdviEngine({ publicBaseUrl = '', fetchImpl = global.fetch } = {}) {
  await ensureGeeInitialized();

  return {
    async searchGeeScenes({ polygon, startDate, endDate, maxCloud }) {
      const gee = await ensureGeeInitialized();
      const geometry = geometryFromPolygon(gee, polygon);
      const collection = sentinelCollection(gee, {
        geometry,
        startDate,
        endDate,
        maxCloud,
      }).limit(50);
      const metadata = await getInfo(
        gee.Dictionary({
          ids: collection.aggregate_array('system:id'),
          times: collection.aggregate_array('system:time_start'),
          clouds: collection.aggregate_array('CLOUDY_PIXEL_PERCENTAGE'),
        }),
      );
      const ids = metadata.ids || [];
      const times = metadata.times || [];
      const clouds = metadata.clouds || [];
      return ids.map((sceneId, index) =>
        mapGeeScene({
          sceneId,
          imageDate: new Date(Number(times[index])).toISOString().slice(0, 10),
          cloudCoverage: clouds[index],
        }),
      );
    },

    async generateGeeNdviLayer({
      sceneId,
      polygon,
      startDate,
      endDate,
      imageDate,
      maxCloud,
      farmId,
      plotId,
      visualMode = VISUAL_MODES.NDVI_CONTRAST,
    }) {
      const gee = await ensureGeeInitialized();
      const mode = visualModes().includes(visualMode) ? visualMode : VISUAL_MODES.NDVI_CONTRAST;
      const geometry = geometryFromPolygon(gee, polygon);
      const statsGeometry = await safeStatsGeometry(gee, geometry);
      const plotGeometry = geometry;
      const image = sceneId
        ? gee.Image(sceneId)
        : sentinelCollection(gee, {
            geometry,
            startDate: startDate || imageDate,
            endDate: endDate || imageDate,
            maxCloud,
          }).first();
      const selectedSceneId = await getInfo(image.id());
      if (!selectedSceneId) {
        const err = new Error('Nenhuma imagem adequada foi encontrada para o período selecionado');
        err.code = 'empty_scenes';
        err.status = 404;
        throw err;
      }

      const selectedImageDate =
        imageDate ||
        new Date(Number(await getInfo(image.get('system:time_start')))).toISOString().slice(0, 10);
      const cloudCoverage = await getInfo(image.get('CLOUDY_PIXEL_PERCENTAGE')).catch(() => null);

      const maskedImage = maskClouds(image);
      const rawNdvi = maskedImage.normalizedDifference(['B8', 'B4']);
      const rawNdre = maskedImage.normalizedDifference(['B8A', 'B5']);
      const rawSavi = maskedImage.expression('((nir - red) / (nir + red + 0.5)) * 1.5', {
        nir: maskedImage.select('B8'),
        red: maskedImage.select('B4'),
      });
      const rawNdmi = maskedImage.normalizedDifference(['B8', 'B11']);
      const rawBsi = maskedImage.expression(
        '((swir + red) - (nir + blue)) / ((swir + red) + (nir + blue))',
        {
          swir: maskedImage.select('B11'),
          red: maskedImage.select('B4'),
          nir: maskedImage.select('B8'),
          blue: maskedImage.select('B2'),
        },
      );

      const statsValidMask = buildNdviValidMask(gee, {
        image,
        ndvi: rawNdvi,
        geometry: statsGeometry.geometry,
      });
      const renderValidMask = buildNdviValidMask(gee, {
        image,
        ndvi: rawNdvi,
        geometry: plotGeometry,
      });
      const statsNdreMask = buildIndexValidMask(gee, {
        image,
        index: rawNdre,
        geometry: statsGeometry.geometry,
        bands: ['B8A', 'B5'],
      });
      const statsNdmiMask = buildIndexValidMask(gee, {
        image,
        index: rawNdmi,
        geometry: statsGeometry.geometry,
        bands: ['B8', 'B11'],
      });
      const renderNdreMask = buildIndexValidMask(gee, {
        image,
        index: rawNdre,
        geometry: plotGeometry,
        bands: ['B8A', 'B5'],
      });
      const renderNdmiMask = buildIndexValidMask(gee, {
        image,
        index: rawNdmi,
        geometry: plotGeometry,
        bands: ['B8', 'B11'],
      });
      const ndvi = maskIndexToGeometry(gee, rawNdvi.updateMask(statsValidMask), statsGeometry.geometry, 'NDVI');
      const ndre = maskIndexToGeometry(gee, rawNdre.updateMask(statsNdreMask), statsGeometry.geometry, 'NDRE');
      const savi = maskIndexToGeometry(gee, rawSavi.updateMask(statsValidMask), statsGeometry.geometry, 'SAVI');
      const ndmi = maskIndexToGeometry(gee, rawNdmi.updateMask(statsNdmiMask), statsGeometry.geometry, 'NDMI');
      const bsi = maskIndexToGeometry(gee, rawBsi.updateMask(statsValidMask), statsGeometry.geometry, 'BSI');
      const renderNdvi = maskIndexToGeometry(gee, rawNdvi.updateMask(renderValidMask), plotGeometry, 'NDVI');
      const renderNdre = maskIndexToGeometry(gee, rawNdre.updateMask(renderNdreMask), plotGeometry, 'NDRE');
      const renderSavi = maskIndexToGeometry(gee, rawSavi.updateMask(renderValidMask), plotGeometry, 'SAVI');
      const renderNdmi = maskIndexToGeometry(gee, rawNdmi.updateMask(renderNdmiMask), plotGeometry, 'NDMI');
      const renderBsi = maskIndexToGeometry(gee, rawBsi.updateMask(renderValidMask), plotGeometry, 'BSI');

      const rendererVersion = rendererVersionFor(mode);
      const maskStats = await calculateGeeMaskStats(gee, {
        image,
        validMask: renderValidMask,
        geometry: plotGeometry,
      });
      const stats = await calculateGeeNdviStats(gee, {
        ndvi,
        ndre,
        savi,
        bsi,
        ndmi,
        geometry: statsGeometry.geometry,
      });
      const minValidPixels = numberFromEnv('GEE_MIN_VALID_PIXELS', 20);
      stats.validPixelCount = maskStats.validPixels;
      stats.maskedPixelCount = maskStats.maskedPixels;
      stats.sclExcludedPixelCount = maskStats.sclExcludedPixels;
      stats.validAreaHa = roundOrNull((maskStats.validPixels * GEE_RENDER_SCALE_M * GEE_RENDER_SCALE_M) / 10000);
      stats.maskedAreaHa = roundOrNull((maskStats.maskedPixels * GEE_RENDER_SCALE_M * GEE_RENDER_SCALE_M) / 10000);
      if (maskStats.validPixels < minValidPixels) {
        const err = new Error('insufficient_valid_ndvi_pixels');
        err.code = 'ndvi_contrast_not_computed';
        err.status = 422;
        err.details = {
          reason: 'insufficient_valid_pixels',
          validPixelCount: maskStats.validPixels,
          maskedPixelCount: maskStats.maskedPixels,
          minValidPixels,
          sclExcludedPixelCount: maskStats.sclExcludedPixels,
        };
        throw err;
      }
      const p5 = stats.ndvi_p5 ?? stats.contrast?.p5;
      const p50 = stats.ndvi_p50 ?? stats.contrast?.p50;
      const p95 = stats.ndvi_p95 ?? stats.contrast?.p95;
      const range = p95 != null && p5 != null ? Number((p95 - p5).toFixed(4)) : null;
      const contrastStretch = resolveContrastStretch(stats);

      if (mode === VISUAL_MODES.NDVI_CONTRAST) {
        const validContrast =
          [p5, p50, p95].every((value) => Number.isFinite(Number(value))) &&
          Number(p5) <= Number(p50) &&
          Number(p50) <= Number(p95);
        if (!validContrast) {
          const err = new Error('invalid_or_missing_percentiles');
          err.code = 'ndvi_contrast_not_computed';
          err.status = 422;
          throw err;
        }
        stats.contrast = {
          ...(stats.contrast || {}),
          p5,
          p50,
          p95,
          rendererVersion,
          stretchMode: contrastStretch.stretchMode,
          stretchMin: roundOrNull(contrastStretch.min),
          stretchMax: roundOrNull(contrastStretch.max),
          gamma: contrastStretch.gamma,
          lowContrastScene: contrastStretch.lowContrastScene,
          edgeBufferM: statsGeometry.bufferAppliedM,
          smoothingRadiusPx: numberFromEnv('GEE_SMOOTHING_RADIUS_PX', DEFAULT_SMOOTHING_RADIUS_PX),
        };
      } else {
        stats.contrast = stats.contrast
          ? { ...stats.contrast, rendererVersion, edgeBufferM: statsGeometry.bufferAppliedM }
          : { rendererVersion, edgeBufferM: statsGeometry.bufferAppliedM };
      }

      const ndviMean = Number(stats.ndvi_mean);
      const ndviP50 = Number(stats.ndvi_p50);
      const ndmiMean = Number(stats.ndmi_mean);
      const ndmiP5 = Number(stats.ndmi_p5);
      const ndmiP95 = Number(stats.ndmi_p95);
      const ndreMean = Number(stats.ndre_mean);
      const ndreP25 = Number(stats.ndre_p25);
      stats.evidence = {
        hasProbableWaterStress:
          Number(stats.waterStressPercent || 0) >= 5 ||
          (Number.isFinite(ndmiMean) && ndmiMean < 0.1),
        hasMoistureGradient:
          Number.isFinite(ndmiP5) &&
          Number.isFinite(ndmiP95) &&
          ndmiP95 - ndmiP5 >= 0.12,
        hasLocalizedDryZone: Number(stats.waterStressPercent || 0) >= 8,
        waterStressPercent: stats.waterStressPercent ?? null,
        hasLowChlorophyllZone: Number(stats.lowChlorophyllPercent || 0) >= 10,
        hasNdreNdviMismatch:
          Number.isFinite(ndviP50) &&
          Number.isFinite(ndreMean) &&
          ndviP50 >= 0.75 &&
          ndreMean <= 0.28,
        ndreMean: stats.ndre_mean ?? null,
        lowChlorophyllPercent: stats.lowChlorophyllPercent ?? null,
        ndviLowNdmiLow:
          Number.isFinite(ndviMean) &&
          Number.isFinite(ndmiMean) &&
          ndviMean < 0.6 &&
          ndmiMean < 0.1,
        ndviHighNdreLow:
          Number.isFinite(ndviP50) &&
          Number.isFinite(ndreP25) &&
          ndviP50 >= 0.75 &&
          ndreP25 <= 0.25,
      };

      const rawRenderImage = resolveIndexImage({
        mode,
        ndvi: renderNdvi,
        ndre: renderNdre,
        savi: renderSavi,
        bsi: renderBsi,
        ndmi: renderNdmi,
      });
      const renderImage = smoothForPreview(rawRenderImage, plotGeometry);
      const renderedPng = await renderVisualPngWithFallback({
        image: renderImage,
        fallbackImage: rawRenderImage,
        stats,
        mode,
        geometry: plotGeometry,
        areaHa: statsGeometry.fullAreaHa,
        fetchImpl,
      });
      const pngBuffer = renderedPng.buffer;
      const previewUrl = await storeNdviPreviewPng({
        farmId,
        plotId,
        sceneId: selectedSceneId,
        imageDate: selectedImageDate,
        visualMode: mode,
        rendererVersion,
        buffer: pngBuffer,
      });

      console.log('[NDVI_RENDER_DISPATCH]');
      console.log('provider=google_earth_engine');
      console.log(`visualMode=${mode}`);
      console.log(`rendererVersion=${rendererVersion}`);
      console.log('modeSupported=true');
      console.log('[NDVI_GEE_MASK]', {
        ...maskStats,
        minValidPixels,
        p5,
        p50,
        p95,
      });
      console.log('[NDVI_SENTINEL_RELIABILITY]', {
        ndviEngineVersion: rendererVersion,
        dataset: DATASET,
        productLevel: 'L2A',
        redBand: 'B4',
        nirBand: 'B8',
        sclAvailable: true,
        cloudMaskVersion: 'scl_v1',
        validPixelCount: maskStats.validPixels,
        maskedPixelCount: maskStats.maskedPixels,
        sclExcludedPixelCount: maskStats.sclExcludedPixels,
        bounds: polygonToBounds(polygon),
      });
      console.log('[NDVI_VISUAL_QUALITY]', {
        scale: GEE_RENDER_SCALE_M,
        dimensions: renderedPng.thumbSize,
        smoothing: renderedPng.smoothingApplied
          ? `focal_median_${numberFromEnv('GEE_SMOOTHING_RADIUS_PX', DEFAULT_SMOOTHING_RADIUS_PX)}px`
          : 'none',
        resample: 'bicubic',
        p5,
        p50,
        p95,
        visualMin: stats.contrast?.stretchMin,
        visualMax: stats.contrast?.stretchMax,
        lowContrastScene: Boolean(stats.contrast?.lowContrastScene),
      });
      console.log('[NDVI_MASK_ALPHA]', {
        validPixels: maskStats.validPixels,
        maskedPixels: maskStats.maskedPixels,
        transparentPixels: maskStats.maskedPixels,
        outsidePolygonTransparent: true,
      });
      console.log('[NDVI_RENDER_V2_FINAL]', {
        visualMode: mode,
        p5,
        p50,
        p95,
        range,
        stretchMode: stats.contrast?.stretchMode,
        stretchMin: stats.contrast?.stretchMin,
        stretchMax: stats.contrast?.stretchMax,
        scaleM: GEE_RENDER_SCALE_M,
        thumbSize: renderedPng.thumbSize,
        edgeBufferM: statsGeometry.bufferAppliedM,
        smoothingRadiusPx: renderedPng.smoothingApplied
          ? numberFromEnv('GEE_SMOOTHING_RADIUS_PX', DEFAULT_SMOOTHING_RADIUS_PX)
          : 0,
        rendererVersion,
        provider: 'google_earth_engine',
        alphaOutsidePolygon: true,
      });

      const agronomicStats = {
        ...stats,
        schema_version: 'ndvi_v3',
        ndvi_schema_version: 3,
        visual_mode: mode,
        renderer_version: rendererVersion,
        available_visual_modes: visualModes(),
        bounds: polygonToBounds(polygon),
        provider: 'google_earth_engine',
        processing_engine: 'google_earth_engine',
        gee_render_scale_m: GEE_RENDER_SCALE_M,
        gee_thumb_size: renderedPng.thumbSize,
        gee_inner_buffer_m: statsGeometry.bufferAppliedM,
        gee_smoothing_radius_px: renderedPng.smoothingApplied
          ? numberFromEnv('GEE_SMOOTHING_RADIUS_PX', DEFAULT_SMOOTHING_RADIUS_PX)
          : 0,
        source_context: {
          dataset: DATASET,
          productLevel: 'L2A',
          redBand: 'B4',
          nirBand: 'B8',
          sclAvailable: true,
          usesUnclassifiedScl: true,
          cloudMaskVersion: 'scl_v1',
          ndviEngineVersion: rendererVersion,
          rasterWidth: renderedPng.thumbSize,
          rasterHeight: renderedPng.thumbSize,
          bboxRequested: polygonToBounds(polygon),
          bboxReturned: polygonToBounds(polygon),
          crs: 'EPSG:4326',
          resolutionMeters: GEE_RENDER_SCALE_M,
          fieldPolygonBounds: polygonToBounds(polygon),
          overlayBounds: polygonToBounds(polygon),
          validPixelCount: maskStats.validPixels,
          maskedPixelCount: maskStats.maskedPixels,
          sclExcludedPixelCount: maskStats.sclExcludedPixels,
        },
      };

      return {
        scene_id: selectedSceneId,
        provider: 'google_earth_engine',
        provider_used: 'google_earth_engine',
        source: 'gee_sentinel_2_l2a',
        processing_engine: 'google_earth_engine',
        image_date: selectedImageDate,
        cloud_coverage:
          cloudCoverage == null || Number.isNaN(Number(cloudCoverage))
            ? null
            : Number(cloudCoverage),
        resolution_m: 10,
        preview_url: previewUrl || (pngBuffer.length <= 900_000
          ? `data:image/png;base64,${pngBuffer.toString('base64')}`
          : null),
        tile_url: null,
        raster_url: null,
        raster_available: false,
        bounds: polygonToBounds(polygon),
        polygon_masked: true,
        status: previewUrl ? 'generated' : 'metadata_only',
        visual_mode: mode,
        available_visual_modes: visualModes(),
        contrast: stats.contrast,
        agronomic_stats_json: agronomicStats,
        ...stats,
      };
    },

    async generateGeeNdviLayerPackage({
      sceneId,
      polygon,
      startDate,
      endDate,
      imageDate,
      maxCloud,
      farmId,
      plotId,
      modes = visualModes(),
    }) {
      const startedAt = Date.now();
      const gee = await ensureGeeInitialized();
      const requestedModes = Array.isArray(modes) && modes.length
        ? modes.filter((mode) => visualModes().includes(mode))
        : visualModes();
      const uniqueModes = [...new Set(requestedModes)];
      const geometry = geometryFromPolygon(gee, polygon);
      const statsGeometry = await safeStatsGeometry(gee, geometry);
      const plotGeometry = geometry;
      const image = sceneId
        ? gee.Image(sceneId)
        : sentinelCollection(gee, {
            geometry,
            startDate: startDate || imageDate,
            endDate: endDate || imageDate,
            maxCloud,
          }).first();
      const selectedSceneId = await getInfo(image.id());
      if (!selectedSceneId) {
        const err = new Error('Nenhuma imagem adequada foi encontrada para o período selecionado');
        err.code = 'empty_scenes';
        err.status = 404;
        throw err;
      }

      const selectedImageDate =
        imageDate ||
        new Date(Number(await getInfo(image.get('system:time_start')))).toISOString().slice(0, 10);
      const cloudCoverage = await getInfo(image.get('CLOUDY_PIXEL_PERCENTAGE')).catch(() => null);
      const maskedImage = maskClouds(image);

      // Pacote único da cena: as bandas são selecionadas uma vez e todos os
      // índices são derivados desse mesmo contexto GEE.
      const rawNdvi = maskedImage.normalizedDifference(['B8', 'B4']);
      const rawNdre = maskedImage.normalizedDifference(['B8A', 'B5']);
      const rawSavi = maskedImage.expression('((nir - red) / (nir + red + 0.5)) * 1.5', {
        nir: maskedImage.select('B8'),
        red: maskedImage.select('B4'),
      });
      const rawNdmi = maskedImage.normalizedDifference(['B8', 'B11']);
      const rawBsi = maskedImage.expression(
        '((swir + red) - (nir + blue)) / ((swir + red) + (nir + blue))',
        {
          swir: maskedImage.select('B11'),
          red: maskedImage.select('B4'),
          nir: maskedImage.select('B8'),
          blue: maskedImage.select('B2'),
        },
      );

      const statsValidMask = buildNdviValidMask(gee, {
        image,
        ndvi: rawNdvi,
        geometry: statsGeometry.geometry,
      });
      const renderValidMask = buildNdviValidMask(gee, {
        image,
        ndvi: rawNdvi,
        geometry: plotGeometry,
      });
      const statsNdreMask = buildIndexValidMask(gee, {
        image,
        index: rawNdre,
        geometry: statsGeometry.geometry,
        bands: ['B8A', 'B5'],
      });
      const statsNdmiMask = buildIndexValidMask(gee, {
        image,
        index: rawNdmi,
        geometry: statsGeometry.geometry,
        bands: ['B8', 'B11'],
      });
      const renderNdreMask = buildIndexValidMask(gee, {
        image,
        index: rawNdre,
        geometry: plotGeometry,
        bands: ['B8A', 'B5'],
      });
      const renderNdmiMask = buildIndexValidMask(gee, {
        image,
        index: rawNdmi,
        geometry: plotGeometry,
        bands: ['B8', 'B11'],
      });

      const ndvi = maskIndexToGeometry(gee, rawNdvi.updateMask(statsValidMask), statsGeometry.geometry, 'NDVI');
      const ndre = maskIndexToGeometry(gee, rawNdre.updateMask(statsNdreMask), statsGeometry.geometry, 'NDRE');
      const savi = maskIndexToGeometry(gee, rawSavi.updateMask(statsValidMask), statsGeometry.geometry, 'SAVI');
      const ndmi = maskIndexToGeometry(gee, rawNdmi.updateMask(statsNdmiMask), statsGeometry.geometry, 'NDMI');
      const bsi = maskIndexToGeometry(gee, rawBsi.updateMask(statsValidMask), statsGeometry.geometry, 'BSI');
      const renderNdvi = maskIndexToGeometry(gee, rawNdvi.updateMask(renderValidMask), plotGeometry, 'NDVI');
      const renderNdre = maskIndexToGeometry(gee, rawNdre.updateMask(renderNdreMask), plotGeometry, 'NDRE');
      const renderSavi = maskIndexToGeometry(gee, rawSavi.updateMask(renderValidMask), plotGeometry, 'SAVI');
      const renderNdmi = maskIndexToGeometry(gee, rawNdmi.updateMask(renderNdmiMask), plotGeometry, 'NDMI');
      const renderBsi = maskIndexToGeometry(gee, rawBsi.updateMask(renderValidMask), plotGeometry, 'BSI');

      const maskStats = await calculateGeeMaskStats(gee, {
        image,
        validMask: renderValidMask,
        geometry: plotGeometry,
      });
      const baseStats = await calculateGeeNdviStats(gee, {
        ndvi,
        ndre,
        savi,
        bsi,
        ndmi,
        geometry: statsGeometry.geometry,
      });
      const minValidPixels = numberFromEnv('GEE_MIN_VALID_PIXELS', 20);
      baseStats.validPixelCount = maskStats.validPixels;
      baseStats.maskedPixelCount = maskStats.maskedPixels;
      baseStats.sclExcludedPixelCount = maskStats.sclExcludedPixels;
      baseStats.validAreaHa = roundOrNull((maskStats.validPixels * GEE_RENDER_SCALE_M * GEE_RENDER_SCALE_M) / 10000);
      baseStats.maskedAreaHa = roundOrNull((maskStats.maskedPixels * GEE_RENDER_SCALE_M * GEE_RENDER_SCALE_M) / 10000);
      if (maskStats.validPixels < minValidPixels) {
        const err = new Error('insufficient_valid_ndvi_pixels');
        err.code = 'ndvi_contrast_not_computed';
        err.status = 422;
        err.details = {
          reason: 'insufficient_valid_pixels',
          validPixelCount: maskStats.validPixels,
          maskedPixelCount: maskStats.maskedPixels,
          minValidPixels,
          sclExcludedPixelCount: maskStats.sclExcludedPixels,
        };
        throw err;
      }

      const p5 = baseStats.ndvi_p5 ?? baseStats.contrast?.p5;
      const p50 = baseStats.ndvi_p50 ?? baseStats.contrast?.p50;
      const p95 = baseStats.ndvi_p95 ?? baseStats.contrast?.p95;
      const contrastStretch = resolveContrastStretch(baseStats);
      const validContrast =
        [p5, p50, p95].every((value) => Number.isFinite(Number(value))) &&
        Number(p5) <= Number(p50) &&
        Number(p50) <= Number(p95);
      if (uniqueModes.includes(VISUAL_MODES.NDVI_CONTRAST) && !validContrast) {
        const err = new Error('invalid_or_missing_percentiles');
        err.code = 'ndvi_contrast_not_computed';
        err.status = 422;
        throw err;
      }

      const ndviMean = Number(baseStats.ndvi_mean);
      const ndviP50 = Number(baseStats.ndvi_p50);
      const ndmiMean = Number(baseStats.ndmi_mean);
      const ndmiP5 = Number(baseStats.ndmi_p5);
      const ndmiP95 = Number(baseStats.ndmi_p95);
      const ndreMean = Number(baseStats.ndre_mean);
      const ndreP25 = Number(baseStats.ndre_p25);
      baseStats.evidence = {
        hasProbableWaterStress:
          Number(baseStats.waterStressPercent || 0) >= 5 ||
          (Number.isFinite(ndmiMean) && ndmiMean < 0.1),
        hasMoistureGradient:
          Number.isFinite(ndmiP5) &&
          Number.isFinite(ndmiP95) &&
          ndmiP95 - ndmiP5 >= 0.12,
        hasLocalizedDryZone: Number(baseStats.waterStressPercent || 0) >= 8,
        waterStressPercent: baseStats.waterStressPercent ?? null,
        hasLowChlorophyllZone: Number(baseStats.lowChlorophyllPercent || 0) >= 10,
        hasNdreNdviMismatch:
          Number.isFinite(ndviP50) &&
          Number.isFinite(ndreMean) &&
          ndviP50 >= 0.75 &&
          ndreMean <= 0.28,
        ndreMean: baseStats.ndre_mean ?? null,
        lowChlorophyllPercent: baseStats.lowChlorophyllPercent ?? null,
        ndviLowNdmiLow:
          Number.isFinite(ndviMean) &&
          Number.isFinite(ndmiMean) &&
          ndviMean < 0.6 &&
          ndmiMean < 0.1,
        ndviHighNdreLow:
          Number.isFinite(ndviP50) &&
          Number.isFinite(ndreP25) &&
          ndviP50 >= 0.75 &&
          ndreP25 <= 0.25,
      };

      console.log('[Package] GEE scene package prepared', {
        field: plotId,
        scene: selectedSceneId,
        resolution: 'preview',
        bands: ['B02', 'B04', 'B05', 'B08', 'B8A', 'B11', 'SCL'],
        modes: uniqueModes,
        elapsedMs: Date.now() - startedAt,
      });

      const layersByMode = {};
      const statusesByMode = {};
      for (const mode of uniqueModes) {
        const modeStartedAt = Date.now();
        try {
          const rendererVersion = rendererVersionFor(mode);
          const stats = JSON.parse(JSON.stringify(baseStats));
          if (mode === VISUAL_MODES.NDVI_CONTRAST) {
            stats.contrast = {
              ...(stats.contrast || {}),
              p5,
              p50,
              p95,
              rendererVersion,
              stretchMode: contrastStretch.stretchMode,
              stretchMin: roundOrNull(contrastStretch.min),
              stretchMax: roundOrNull(contrastStretch.max),
              gamma: contrastStretch.gamma,
              lowContrastScene: contrastStretch.lowContrastScene,
              edgeBufferM: statsGeometry.bufferAppliedM,
              smoothingRadiusPx: numberFromEnv('GEE_SMOOTHING_RADIUS_PX', DEFAULT_SMOOTHING_RADIUS_PX),
            };
          } else {
            stats.contrast = stats.contrast
              ? { ...stats.contrast, rendererVersion, edgeBufferM: statsGeometry.bufferAppliedM }
              : { rendererVersion, edgeBufferM: statsGeometry.bufferAppliedM };
          }

          const rawRenderImage = resolveIndexImage({
            mode,
            ndvi: renderNdvi,
            ndre: renderNdre,
            savi: renderSavi,
            bsi: renderBsi,
            ndmi: renderNdmi,
          });
          const renderImage = smoothForPreview(rawRenderImage, plotGeometry);
          const renderedPng = await renderVisualPngWithFallback({
            image: renderImage,
            fallbackImage: rawRenderImage,
            stats,
            mode,
            geometry: plotGeometry,
            areaHa: statsGeometry.fullAreaHa,
            fetchImpl,
          });
          const pngBuffer = renderedPng.buffer;
          const previewUrl = await storeNdviPreviewPng({
            farmId,
            plotId,
            sceneId: selectedSceneId,
            imageDate: selectedImageDate,
            visualMode: mode,
            rendererVersion,
            buffer: pngBuffer,
          });
          const agronomicStats = {
            ...stats,
            schema_version: 'ndvi_v3',
            ndvi_schema_version: 3,
            visual_mode: mode,
            renderer_version: rendererVersion,
            available_visual_modes: visualModes(),
            bounds: polygonToBounds(polygon),
            provider: 'google_earth_engine',
            processing_engine: 'google_earth_engine',
            gee_render_scale_m: GEE_RENDER_SCALE_M,
            gee_thumb_size: renderedPng.thumbSize,
            gee_inner_buffer_m: statsGeometry.bufferAppliedM,
            gee_smoothing_radius_px: renderedPng.smoothingApplied
              ? numberFromEnv('GEE_SMOOTHING_RADIUS_PX', DEFAULT_SMOOTHING_RADIUS_PX)
              : 0,
            source_context: {
              dataset: DATASET,
              productLevel: 'L2A',
              redBand: 'B4',
              nirBand: 'B8',
              sclAvailable: true,
              usesUnclassifiedScl: true,
              cloudMaskVersion: 'scl_v1',
              ndviEngineVersion: rendererVersion,
              rasterWidth: renderedPng.thumbSize,
              rasterHeight: renderedPng.thumbSize,
              bboxRequested: polygonToBounds(polygon),
              bboxReturned: polygonToBounds(polygon),
              crs: 'EPSG:4326',
              resolutionMeters: GEE_RENDER_SCALE_M,
              fieldPolygonBounds: polygonToBounds(polygon),
              overlayBounds: polygonToBounds(polygon),
              validPixelCount: maskStats.validPixels,
              maskedPixelCount: maskStats.maskedPixels,
              sclExcludedPixelCount: maskStats.sclExcludedPixels,
              packageVersion: 'scene_band_package_v1',
              packageElapsedMs: Date.now() - startedAt,
            },
          };
          layersByMode[mode] = {
            scene_id: selectedSceneId,
            provider: 'google_earth_engine',
            provider_used: 'google_earth_engine',
            source: 'gee_sentinel_2_l2a',
            processing_engine: 'google_earth_engine',
            image_date: selectedImageDate,
            cloud_coverage:
              cloudCoverage == null || Number.isNaN(Number(cloudCoverage))
                ? null
                : Number(cloudCoverage),
            resolution_m: 10,
            preview_url: previewUrl || (pngBuffer.length <= 900_000
              ? `data:image/png;base64,${pngBuffer.toString('base64')}`
              : null),
            tile_url: null,
            raster_url: null,
            raster_available: false,
            bounds: polygonToBounds(polygon),
            polygon_masked: true,
            status: previewUrl ? 'generated' : 'metadata_only',
            visual_mode: mode,
            available_visual_modes: visualModes(),
            contrast: stats.contrast,
            agronomic_stats_json: agronomicStats,
            ...stats,
          };
          statusesByMode[mode] = {
            status: 'ready',
            elapsedMs: Date.now() - modeStartedAt,
            preview: Boolean(layersByMode[mode].preview_url),
          };
          console.log(`[LayerBatch] ${mode} ready from single GEE package`, statusesByMode[mode]);
        } catch (error) {
          statusesByMode[mode] = {
            status: error?.status === 422 ? 'unavailable' : 'failed',
            code: error?.code || 'gee_layer_render_failed',
            message: error?.message || String(error),
            elapsedMs: Date.now() - modeStartedAt,
          };
          console.warn(`[LayerBatch] ${mode} failed from single GEE package`, statusesByMode[mode]);
        }
      }

      return {
        scene_id: selectedSceneId,
        package_version: 'scene_band_package_v1',
        resolution_kind: 'preview',
        provider: 'google_earth_engine',
        provider_used: 'google_earth_engine',
        modes: uniqueModes,
        layersByMode,
        statusesByMode,
        elapsedMs: Date.now() - startedAt,
      };
    },
  };
}
