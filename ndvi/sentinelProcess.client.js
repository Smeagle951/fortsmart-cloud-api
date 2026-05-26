/**
 * Processamento NDVI via Copernicus Process API (somente servidor).
 * Preview: PNG colorido. Stats: segundo PNG em escala de cinza (NDVI real B04/B08).
 */
import { computeNdviStatsFromFloatEncodedPng } from './ndviGrayscaleStats.js';
import {
  buildAbsoluteColorEvalscript,
  buildRelativeColorEvalscript,
  logColormapDiagnostics,
  pickPreviewColormapMode,
} from './ndviColormap.js';
import { storeNdviPreviewPng } from './ndviPreviewStorage.js';

const DEFAULT_PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';

/** R=G=B = (clamp(ndvi,-1,1)+1)/2 — stats derivadas do NDVI float, não da paleta. */
const EVALSCRIPT_FLOAT_GRAY = `//VERSION=3
function setup() {
  return {
    input: ["B04", "B08", "dataMask"],
    output: { bands: 4, sampleType: 'AUTO' }
  };
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
    console.warn(
      `⚠️ [NDVI] SENTINEL_PROCESS_URL legado (${value}) — usando ${DEFAULT_PROCESS_URL}`,
    );
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

  async _postProcessPng({
    token,
    polygon,
    date,
    evalscript,
    width,
    height,
    sceneId,
    label,
  }) {
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
              timeRange: {
                from: `${date}T00:00:00Z`,
                to: `${date}T23:59:59Z`,
              },
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
      console.warn(
        `⚠️ [NDVI][Process][${label}] HTTP ${response.status} body=${errText.slice(0, 200)}`,
      );
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) return null;
    return buffer;
  }

  async generateNdviLayer({
    sceneId,
    polygon,
    imageDate,
    farmId,
    plotId,
    colormapMode = 'auto',
  }) {
    const isProd = process.env.NODE_ENV === 'production';
    if (!this.authClient?.isConfigured()) {
      if (isProd && !this.enableDevMock) {
        const err = new Error(
          'Copernicus CDSE não configurado (CDSE_CLIENT_ID/SECRET)',
        );
        err.code = 'cdse_not_configured';
        err.status = 503;
        throw err;
      }
      return this._mockAssets({ farmId, plotId, imageDate });
    }

    if (this.enableDevMock) {
      return this._mockAssets({ farmId, plotId, imageDate });
    }

    const token = await this.authClient.getCdseAccessToken();
    const date = String(imageDate || '').slice(0, 10);
    if (!date) {
      return {
        preview_url: null,
        tile_url: null,
        raster_url: null,
        status: 'metadata_only',
      };
    }

    try {
      // 1) Stats NDVI float (cinza) — antes do preview colorido
      const statsBuf = await this._postProcessPng({
        token,
        polygon,
        date,
        evalscript: EVALSCRIPT_FLOAT_GRAY,
        width: 256,
        height: 256,
        sceneId,
        label: 'stats_float',
      });

      const stats = statsBuf
        ? computeNdviStatsFromFloatEncodedPng(statsBuf, { sceneId })
        : null;

      if (!stats) {
        console.warn(`⚠️ [NDVI][Process] stats indisponíveis sceneId=${sceneId}`);
        return {
          preview_url: null,
          tile_url: null,
          raster_url: null,
          status: 'metadata_only',
        };
      }

      const resolvedColormap = pickPreviewColormapMode(stats, colormapMode);
      logColormapDiagnostics({ sceneId, stats, colormapMode: resolvedColormap });

      const colorEvalscript =
        resolvedColormap === 'relative'
          ? buildRelativeColorEvalscript(stats.ndvi_min, stats.ndvi_max)
          : buildAbsoluteColorEvalscript();

      // 2) Preview colorido pixel a pixel (nunca por ndviMean)
      const colorBuf = await this._postProcessPng({
        token,
        polygon,
        date,
        evalscript: colorEvalscript,
        width: 512,
        height: 512,
        sceneId,
        label: `preview_color_${resolvedColormap}`,
      });

      if (!colorBuf) {
        return {
          preview_url: null,
          tile_url: null,
          raster_url: null,
          status: 'metadata_only',
          ...stats,
        };
      }

      const preview_url = await storeNdviPreviewPng({
        farmId,
        plotId,
        sceneId,
        imageDate: date,
        buffer: colorBuf,
      });

      console.log(
        `ℹ️ [NDVI][Process] preview sceneId=${sceneId} colormap=${resolvedColormap} ` +
          `mean=${stats.ndvi_mean} min=${stats.ndvi_min} max=${stats.ndvi_max} ` +
          `previewGenerated=${preview_url ? 'yes' : 'no'}`,
      );

      return {
        preview_url,
        tile_url: null,
        raster_url: null,
        colormap_mode: resolvedColormap,
        status: preview_url ? 'generated' : 'metadata_only',
        ...stats,
      };
    } catch (error) {
      console.warn(`⚠️ [NDVI][Process] falha sceneId=${sceneId}: ${error.message}`);
      return {
        preview_url: null,
        tile_url: null,
        raster_url: null,
        status: 'metadata_only',
      };
    }
  }

  _mockAssets({ farmId, plotId, imageDate }) {
    const prefix = this.publicBaseUrl || 'https://dummyimage.com';
    const stamp = String(imageDate || '').replace(/-/g, '');
    return {
      preview_url: `${prefix}/1024x768/2e7d32/ffffff.png&text=NDVI+${plotId}+${stamp}`,
      tile_url: `${prefix}/512x512/33691e/ffffff.png&text=NDVI+TILE+${farmId}`,
      raster_url: `${prefix}/1200x900/1b5e20/ffffff.png&text=NDVI+RASTER+${plotId}`,
      ndvi_mean: 0.62,
      ndvi_min: 0.35,
      ndvi_max: 0.81,
      very_low_percent: 5,
      low_percent: 25,
      medium_percent: 40,
      high_percent: 30,
      status: 'generated',
    };
  }
}

export default SentinelProcessClient;
