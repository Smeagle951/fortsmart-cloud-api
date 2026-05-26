/**
 * Processamento NDVI via Copernicus Process API.
 * DOIS requests: preview colorido + PNG cinza para stats float reais (não paleta).
 */
import { computeNdviStatsFromFloatEncodedPng } from './ndviGrayscaleStats.js';
import { storeNdviPreviewPng } from './ndviPreviewStorage.js';

const DEFAULT_PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';

const EVALSCRIPT_COLOR_PREVIEW = `//VERSION=3
function setup() {
  return { input: ["B04", "B08", "dataMask"], output: { bands: 4, sampleType: 'AUTO' } };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0, 0, 0, 0];
  const ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
  if (!isFinite(ndvi)) return [0, 0, 0, 0];
  if (ndvi < 0.1) return [0.75, 0.05, 0.05, 1];
  if (ndvi < 0.25) return [0.95, 0.35, 0.1, 1];
  if (ndvi < 0.4) return [0.98, 0.75, 0.15, 1];
  if (ndvi < 0.55) return [0.85, 0.9, 0.2, 1];
  if (ndvi < 0.7) return [0.4, 0.75, 0.25, 1];
  return [0.1, 0.55, 0.15, 1];
}`;

/** R=G=B = (clamp(ndvi,-1,1)+1)/2 — NDVI numérico puro, sem colorização. */
const EVALSCRIPT_FLOAT_GRAY = `//VERSION=3
function setup() {
  return { input: ["B04", "B08", "dataMask"], output: { bands: 4, sampleType: 'AUTO' } };
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0, 0, 0, 0];
  const ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
  if (!isFinite(ndvi)) return [0, 0, 0, 0];
  const clamped = Math.max(-1, Math.min(1, ndvi));
  const v = (clamped + 1) / 2;
  return [v, v, v, 1];
}`;

function resolveProcessUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return DEFAULT_PROCESS_URL;
  if (value.includes('/process/v1') && !value.includes('/api/v1/process')) {
    console.warn(`⚠️ [NDVI] SENTINEL_PROCESS_URL legado (${value}) — usando ${DEFAULT_PROCESS_URL}`);
    return DEFAULT_PROCESS_URL;
  }
  return value;
}

class SentinelProcessClient {
  constructor({
    authClient,
    processUrl = process.env.SENTINEL_PROCESS_URL,
    enableDevMock = false,
    publicBaseUrl = '',
    fetchImpl = global.fetch,
  } = {}) {
    this.authClient = authClient;
    this.processUrl = resolveProcessUrl(processUrl);
    this.enableDevMock = enableDevMock;
    this.publicBaseUrl = publicBaseUrl;
    this.fetchImpl = fetchImpl;
  }

  async _postProcessPng({ token, polygon, date, evalscript, width, height, sceneId, label }) {
    const payload = {
      input: {
        bounds: {
          geometry: polygon,
          properties: { crs: 'http://www.opengis.net/def/crs/EPSG/0/4326' },
        },
        data: [
          {
            type: 'sentinel-2-l2a',
            dataFilter: {
              timeRange: { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z` },
              mosaickingOrder: 'leastCC',
            },
          },
        ],
      },
      output: {
        width,
        height,
        responses: [{ identifier: 'default', format: { type: 'image/png' } }],
      },
      evalscript,
    };

    const started = Date.now();
    const response = await this.fetchImpl(this.processUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'image/png',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000),
    });

    const elapsedMs = Date.now() - started;
    const contentType = response.headers.get('content-type') || '';
    console.log(
      `ℹ️ [NDVI][Process][${label}] sceneId=${sceneId} status=${response.status} ` +
        `elapsedMs=${elapsedMs} contentType=${contentType} size=${width}x${height}`,
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(`⚠️ [NDVI][Process][${label}] HTTP ${response.status} body=${errText.slice(0, 200)}`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) return null;
    return buffer;
  }

  async generateNdviLayer({ sceneId, polygon, imageDate, farmId, plotId, campaignId }) {
    const isProd = process.env.NODE_ENV === 'production';
    if (!this.authClient?.isConfigured()) {
      if (isProd && !this.enableDevMock) {
        const err = new Error('Copernicus CDSE não configurado (CDSE_CLIENT_ID/SECRET)');
        err.code = 'cdse_not_configured';
        err.status = 503;
        throw err;
      }
      return this._mockAssets({ farmId, plotId, imageDate });
    }

    if (this.enableDevMock) return this._mockAssets({ farmId, plotId, imageDate });

    const token = await this.authClient.getCdseAccessToken();
    const date = String(imageDate || '').slice(0, 10);
    if (!date) {
      return { preview_url: null, tile_url: null, raster_url: null, status: 'metadata_only' };
    }

    try {
      // Request 1: preview colorido
      const colorBuf = await this._postProcessPng({
        token, polygon, date,
        evalscript: EVALSCRIPT_COLOR_PREVIEW,
        width: 512, height: 512, sceneId, label: 'preview_color',
      });

      if (!colorBuf) {
        console.warn(`⚠️ [NDVI][Process] preview_color vazio sceneId=${sceneId}`);
        return { preview_url: null, tile_url: null, raster_url: null, status: 'metadata_only' };
      }

      const preview_url = await storeNdviPreviewPng({
        farmId, plotId, sceneId, imageDate: date, buffer: colorBuf,
      });

      // Request 2: PNG cinza para stats NDVI float reais
      const statsBuf = await this._postProcessPng({
        token, polygon, date,
        evalscript: EVALSCRIPT_FLOAT_GRAY,
        width: 256, height: 256, sceneId, label: 'stats_float',
      });

      const stats = statsBuf
        ? computeNdviStatsFromFloatEncodedPng(statsBuf, { sceneId })
        : null;

      console.log(
        `ℹ️ [NDVI][Process] statsFloat sceneId=${sceneId} ` +
          `mean=${stats?.ndvi_mean ?? '-'} min=${stats?.ndvi_min ?? '-'} max=${stats?.ndvi_max ?? '-'} ` +
          `previewGenerated=${preview_url ? 'yes' : 'no'} statsComputed=${stats ? 'yes' : 'no'}`,
      );

      return {
        preview_url,
        tile_url: null,
        raster_url: null,
        status: preview_url && stats ? 'generated' : 'metadata_only',
        ...stats,
      };
    } catch (error) {
      console.warn(`⚠️ [NDVI][Process] falha sceneId=${sceneId}: ${error.message}`);
      return { preview_url: null, tile_url: null, raster_url: null, status: 'metadata_only' };
    }
  }

  _mockAssets({ farmId, plotId, imageDate }) {
    const prefix = this.publicBaseUrl || 'https://dummyimage.com';
    const stamp = String(imageDate || '').replace(/-/g, '');
    return {
      preview_url: `${prefix}/1024x768/2e7d32/ffffff.png&text=NDVI+${plotId}+${stamp}`,
      tile_url: `${prefix}/512x512/33691e/ffffff.png&text=NDVI+TILE+${farmId}`,
      raster_url: `${prefix}/1200x900/1b5e20/ffffff.png&text=NDVI+RASTER+${plotId}`,
      ndvi_mean: 0.62, ndvi_min: 0.35, ndvi_max: 0.81,
      very_low_percent: 5, low_percent: 25, medium_percent: 40, high_percent: 30,
      status: 'generated',
    };
  }
}

export default SentinelProcessClient;
