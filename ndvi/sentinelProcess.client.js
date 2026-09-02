/**
 * Processamento NDVI multibandas via Copernicus Process API.
 */
import { PNG } from 'pngjs';
import { computeAgronomicStatsFromPackedPngs } from './ndviAgronomicStats.js';
import { computeSurfaceCoverStatsFromPackedPng } from './ndviSurfaceCoverStats.js';
import {
  buildSurfaceCoverPackedEvalscript,
  buildSurfaceCoverPreviewEvalscript,
} from './ndviSurfaceCoverEvalscript.js';
import {
  isCdseSurfaceCoverMode,
  SURFACE_COVER_ALGORITHM,
} from './ndviSurfaceCoverCore.js';
import {
  buildAgronomicPackedStatsEvalscript,
  buildIndicesPackedStatsEvalscript,
  buildNdviOnlyPackedStatsEvalscript,
  isNdviOnlyVisualMode,
  VISUAL_MODES,
} from './ndviAgronomicEvalscript.js';
import { createNdviTimingTrace, newNdviRequestId } from './ndviGenerateLogger.js';
import { storeNdviPreviewPng } from './ndviPreviewStorage.js';
import {
  colorBucketsForValues,
  resolveContrastStretch,
} from './ndviContrastEngine.js';
import { smoothPreviewPngBuffer } from './ndviSpatialSmoothing.js';
import { renderAgronomicContrastV2 } from './agronomicContrastRendererV2.js';
import { buildNdviRasterMetadata } from './ndviRasterMetadata.js';
import { buildNdviZones } from './ndviZoneBuilder.js';
import {
  buildInternalGridDocument,
  storeInternalGrid,
  loadInternalGrid,
} from './ndviRasterStore.js';
import { generatePreviewFromRaster } from './ndviPreviewFromRaster.js';
import { RASTER_SCHEMA_NUM } from './ndviRasterSerializer.js';
import { maskValuesToPolygon } from './ndviPolygonMask.js';

const DEFAULT_PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process';

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

function normalizeVisualMode(mode, colormapMode) {
  const raw = String(mode || colormapMode || 'ndvi_contrast').toLowerCase();
  if (raw === 'auto') return 'ndvi_contrast';
  if (raw === 'absolute') return 'ndvi_absolute';
  if (raw === 'contrast') return 'ndvi_contrast';
  if (raw === 'relative') return 'ndvi_relative';
  if (VISUAL_MODES.includes(raw)) return raw;
  return 'ndvi_contrast';
}

function polygonToBounds(polygon) {
  const coords = polygon?.coordinates?.[0];
  if (!Array.isArray(coords) || coords.length === 0) return null;
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const point of coords) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (![west, east, south, north].every(Number.isFinite)) return null;
  return { south, west, north, east };
}

function analyzePreviewColorBuckets(buffer) {
  try {
    const png = PNG.sync.read(buffer);
    const counts = new Map();
    let total = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      const alpha = png.data[i + 3];
      if (alpha < 16) continue;
      const key = `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      total += 1;
    }
    if (!total) return null;
    let dominant = 0;
    for (const count of counts.values()) {
      if (count > dominant) dominant = count;
    }
    return {
      total,
      uniqueColors: counts.size,
      dominantRatio: dominant / total,
    };
  } catch (error) {
    console.warn(`[NDVI][Contrast] não foi possível auditar preview PNG: ${error.message}`);
    return null;
  }
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
    console.log(
      `ℹ️ [NDVI][Process][${label}] sceneId=${sceneId} status=${response.status} ` +
        `elapsedMs=${elapsedMs} size=${width}x${height}`,
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(
        `⚠️ [NDVI][Process][${label}] HTTP ${response.status} body=${errText.slice(0, 200)}`,
      );
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length ? buffer : null;
  }

  async _layerFromPersistedRaster({
    raster,
    sceneId,
    farmId,
    plotId,
    imageDate,
    polygon,
    visualMode,
    stats = {},
  }) {
    const resolvedVisual = normalizeVisualMode(visualMode, null);
    const previewGen = generatePreviewFromRaster({
      raster,
      visualMode: resolvedVisual,
      polygon,
    });
    console.log('[NDVI_PREVIEW_FROM_RASTER]', {
      sceneId,
      visualMode: resolvedVisual,
      rasterReuse: true,
    });

    const bounds = previewGen.bounds ?? polygonToBounds(polygon);

    const preview_url = await storeNdviPreviewPng({
      farmId,
      plotId,
      sceneId,
      imageDate,
      visualMode: resolvedVisual,
      rendererVersion: previewGen.contrast?.rendererVersion ?? 'agronomic_contrast_v2',
      buffer: previewGen.buffer,
    });

    const recomputedStats = previewGen.stats ?? {};
    const contrast = previewGen.contrast ?? recomputedStats.contrast ?? stats.contrast ?? {};
    const rendererVersion = contrast?.rendererVersion ?? 'agronomic_contrast_v2_1';
    const rasterMetadata = buildNdviRasterMetadata({
      grid: { values: Array.from(raster.bands.ndvi), width: raster.width, height: raster.height },
      bounds,
      rasterUrl: null,
      resolutionM: raster.resolution_m ?? 10,
    });
    const sourceContext = {
      ...(previewGen.sourceContext || {}),
      cacheHit: true,
      cacheTag: `${plotId}|${sceneId}|${resolvedVisual}|${rendererVersion}`,
      rendererVersion,
      rasterStorageKey: raster.raster_storage_key ?? raster.storageKey ?? null,
      metadataComplete: Boolean(previewGen.stats),
    };

    console.log('[NDVI_RASTER_REUSE_METADATA]', {
      sceneId,
      visualMode: resolvedVisual,
      rendererVersion,
      metadataComplete: Boolean(previewGen.stats),
      statsRecomputed: true,
      validPixelCount: recomputedStats.validPixelCount ?? null,
      mean: recomputedStats.ndvi_mean ?? null,
      p05: recomputedStats.ndvi_p5 ?? null,
      p50: recomputedStats.ndvi_p50 ?? null,
      p95: recomputedStats.ndvi_p95 ?? null,
      contrast: recomputedStats.contrast?.contrast ?? recomputedStats.contrast ?? null,
      homogeneity: recomputedStats.homogeneity_score ?? null,
    });

    return {
      preview_url,
      tile_url: null,
      raster_url: null,
      raster_format: 'internal_grid',
      raster_bands: rasterMetadata.raster_bands,
      raster_bounds: bounds,
      raster_resolution_m: raster.resolution_m ?? 10,
      raster_available: true,
      raster_storage_key: raster.raster_storage_key ?? raster.storageKey ?? null,
      raster_storage_provider: raster.raster_storage_provider ?? raster.provider ?? null,
      raster_schema_version: raster.raster_schema_version ?? RASTER_SCHEMA_NUM,
      bounds,
      visual_mode: resolvedVisual,
      colormap_mode: resolvedVisual,
      processing_engine: 'internal_grid_v1',
      provider: raster.provider || 'copernicus_dataspace',
      source: raster.source || 'sentinel-2-l2a',
      status: preview_url ? 'generated' : 'metadata_only',
      polygon_masked: true,
      available_visual_modes: VISUAL_MODES,
      contrast,
      spatial_metrics: recomputedStats.spatial_metrics ?? previewGen.spatial_metrics ?? stats.spatial_metrics,
      rendering: recomputedStats.rendering ?? stats.rendering,
      zones: previewGen.zones ?? stats.zones ?? [],
      diagnosis: previewGen.diagnosis ?? null,
      legend: previewGen.legend ?? null,
      sourceContext,
      source_context: sourceContext,
      rendererVersion,
      renderer_version: rendererVersion,
      cacheHit: true,
      cache_hit: true,
      cacheTag: sourceContext.cacheTag,
      cache_tag: sourceContext.cacheTag,
      generatedAt: new Date().toISOString(),
      generated_at: new Date().toISOString(),
      rasterReuse: true,
      stats: {
        ...stats,
        ...recomputedStats,
        sourceContext,
        source_context: sourceContext,
        diagnosis: previewGen.diagnosis ?? null,
        legend: previewGen.legend ?? null,
      },
      ...stats,
      ...recomputedStats,
    };
  }

  async tryGenerateFromPersistedRaster({
    sceneId,
    polygon,
    imageDate,
    farmId,
    plotId,
    visualMode,
    colormapMode,
  }) {
    const resolvedVisual = normalizeVisualMode(visualMode, colormapMode);
    if (isCdseSurfaceCoverMode(resolvedVisual)) return null;
    const raster = await loadInternalGrid({
      plotId,
      sceneId,
      schemaVersion: RASTER_SCHEMA_NUM,
    });
    if (!raster?.bands?.ndvi?.length) return null;
    return this._layerFromPersistedRaster({
      raster,
      sceneId,
      farmId,
      plotId,
      imageDate,
      polygon,
      visualMode: normalizeVisualMode(visualMode, colormapMode),
    });
  }

  async generateLayerPackage({
    sceneId,
    polygon,
    imageDate,
    farmId,
    plotId,
    modes = VISUAL_MODES,
  }) {
    const requestedModes = [...new Set(
      (Array.isArray(modes) && modes.length ? modes : VISUAL_MODES)
        .map((mode) => normalizeVisualMode(mode, null)),
    )];
    const date = String(imageDate || '').slice(0, 10);
    const started = Date.now();
    const layersByMode = {};
    const statusesByMode = {};

    console.log('[NDVI][Process][package] start', {
      sceneId,
      plotId,
      modes: requestedModes,
      date,
    });

    if (!date) {
      for (const mode of requestedModes) {
        statusesByMode[mode] = {
          status: 'failed',
          code: 'invalidImageDate',
          message: 'Data da cena inválida para gerar pacote Sentinel.',
          elapsedMs: 0,
        };
      }
      return {
        scene_id: sceneId,
        resolution_kind: 'preview',
        package_version: 'scene_band_package_v1',
        layersByMode,
        statusesByMode,
        elapsedMs: Date.now() - started,
      };
    }

    console.log('[NDVI] cache raster lookup', {
      plotId,
      sceneId,
      key: [plotId, sceneId || '-', 'internal_grid_v1'].join('|'),
    });
    let raster = await loadInternalGrid({
      plotId,
      sceneId,
      schemaVersion: RASTER_SCHEMA_NUM,
    });

    if (!raster?.bands?.ndvi?.length) {
      console.log('[NDVI] raster miss', { plotId, sceneId });
      console.log('[NDVI][Process][package] raster miss; generating base raster', {
        sceneId,
        plotId,
      });
      const base = await this.generateNdviLayer({
        sceneId,
        polygon,
        imageDate: date,
        farmId,
        plotId,
        visualMode: 'ndvi_contrast',
        forceRemote: false,
      });
      if (base?.raster_storage_key || base?.raster_available) {
        raster = await loadInternalGrid({
          plotId,
          sceneId,
          schemaVersion: RASTER_SCHEMA_NUM,
        });
      }
    } else {
      console.log('[NDVI] raster hit', { plotId, sceneId });
    }

    if (!raster?.bands?.ndvi?.length) {
      for (const mode of requestedModes) {
        statusesByMode[mode] = {
          status: 'failed',
          code: 'packageRasterNotComputed',
          message: 'Pacote Sentinel não gerou raster interno reutilizável.',
          elapsedMs: Date.now() - started,
        };
      }
      return {
        scene_id: sceneId,
        resolution_kind: 'preview',
        package_version: 'scene_band_package_v1',
        layersByMode,
        statusesByMode,
        elapsedMs: Date.now() - started,
      };
    }

    await Promise.all(
      requestedModes.map(async (mode) => {
      const modeStarted = Date.now();
      try {
        console.log('[NDVI] render layer started', {
          plotId,
          sceneId,
          mode,
        });
        if (isCdseSurfaceCoverMode(mode)) {
          const layer = await this.generateNdviLayer({
            sceneId,
            polygon,
            imageDate: date,
            farmId,
            plotId,
            visualMode: mode,
            forceRemote: true,
          });
          if (!layer?.preview_url) {
            statusesByMode[mode] = {
              status: 'unavailable',
              code: 'surfaceCoverNotComputed',
              message:
                'Classificação de cobertura não gerada (bandas SWIR/Red Edge insuficientes ou cena inválida).',
              elapsedMs: Date.now() - modeStarted,
            };
            return;
          }
          layersByMode[mode] = layer;
          statusesByMode[mode] = {
            status: 'ready',
            elapsedMs: Date.now() - modeStarted,
            preview: true,
            source: 'cdse_surface_cover',
          };
          return;
        }
        const layer = await this._layerFromPersistedRaster({
          raster,
          sceneId,
          farmId,
          plotId,
          imageDate: date,
          polygon,
          visualMode: mode,
        });
        if (!layer?.preview_url) {
          statusesByMode[mode] = {
            status: 'unavailable',
            code: 'layerPreviewNotComputed',
            message: `Camada ${mode} não retornou preview reutilizável.`,
            elapsedMs: Date.now() - modeStarted,
          };
          return;
        }
        layersByMode[mode] = layer;
        statusesByMode[mode] = {
          status: 'ready',
          elapsedMs: Date.now() - modeStarted,
          preview: true,
          source: 'internal_grid_package',
        };
        console.log('[NDVI] render layer finished', {
          plotId,
          sceneId,
          mode,
          elapsedMs: Date.now() - modeStarted,
          bytes: layer?.preview_url ? String(layer.preview_url).length : 0,
        });
      } catch (error) {
        statusesByMode[mode] = {
          status: 'failed',
          code: error?.code || 'packageLayerRenderFailed',
          message: error?.message || String(error),
          elapsedMs: Date.now() - modeStarted,
        };
      }
      }),
    );

    console.log('[NDVI][Process][package] done', {
      sceneId,
      plotId,
      readyModes: Object.keys(layersByMode),
      elapsedMs: Date.now() - started,
    });
    console.log('[NDVI] package saved', {
      key: [plotId, sceneId || '-', 'preview'].join('|'),
      layers: Object.keys(layersByMode),
    });

    return {
      scene_id: sceneId,
      packageCacheKey: [plotId, sceneId || '-', 'preview'].join('|'),
      package_version: 'scene_band_package_v1',
      resolution_kind: 'preview',
      generatedAt: new Date().toISOString(),
      provider: 'copernicus_dataspace',
      modes: requestedModes,
      layersByMode,
      statusesByMode,
      elapsedMs: Date.now() - started,
    };
  }

  async generateNdviLayer({
    sceneId,
    polygon,
    imageDate,
    farmId,
    plotId,
    colormapMode = 'ndvi_contrast',
    visualMode = null,
    forceRemote = false,
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
        status: 'metadata_only',
      };
    }

    const resolvedVisual = normalizeVisualMode(visualMode, colormapMode);
    if (isCdseSurfaceCoverMode(resolvedVisual)) {
      return this._generateSurfaceCoverLayer({
        token,
        polygon,
        date,
        sceneId,
        farmId,
        plotId,
        visualMode: resolvedVisual,
      });
    }

    if (!forceRemote) {
      const reused = await this.tryGenerateFromPersistedRaster({
        sceneId,
        polygon,
        imageDate: date,
        farmId,
        plotId,
        visualMode: resolvedVisual,
        colormapMode,
      });
      if (reused?.preview_url) return reused;
    }

    try {
      const timing = createNdviTimingTrace({
        requestId: newNdviRequestId('process'),
        plotId,
        sceneId,
        farmId,
        mode: resolvedVisual,
        source: 'sentinelProcess',
      });
      timing.mark('request_started', { forceRemote: Boolean(forceRemote) });
      timing.mark('cdse_auth_ok');

      const ndviOnly = isNdviOnlyVisualMode(resolvedVisual);
      let primaryBuf;
      let indicesBuf = null;

      if (ndviOnly) {
        // NDVI V1: uma chamada Process com B04+B08+SCL — sem B05/B8A/B11/B12.
        timing.mark('bands_selected', { bands: 'B04,B08,SCL', path: 'ndvi_v1' });
        timing.mark('download_started', { calls: 1, size: '256x256' });
        primaryBuf = await this._postProcessPng({
          token,
          polygon,
          date,
          evalscript: buildNdviOnlyPackedStatsEvalscript(),
          width: 256,
          height: 256,
          sceneId,
          label: 'ndvi_v1_stats',
        });
        timing.mark('download_completed', {
          primaryBytes: primaryBuf?.length ?? 0,
          indicesBytes: 0,
        });
      } else {
        timing.mark('bands_selected', {
          bands: 'B02,B03,B04,B05,B06,B07,B08,B8A,B11,B12,SCL',
          path: 'full_package',
        });
        timing.mark('download_started', { calls: 2, size: '256x256' });
        // Avançado: primary + indices em paralelo.
        const pair = await Promise.all([
          this._postProcessPng({
            token,
            polygon,
            date,
            evalscript: buildAgronomicPackedStatsEvalscript(),
            width: 256,
            height: 256,
            sceneId,
            label: 'agro_stats_primary',
          }),
          this._postProcessPng({
            token,
            polygon,
            date,
            evalscript: buildIndicesPackedStatsEvalscript(),
            width: 256,
            height: 256,
            sceneId,
            label: 'agro_stats_indices',
          }),
        ]);
        primaryBuf = pair[0];
        indicesBuf = pair[1];
        timing.mark('download_completed', {
          primaryBytes: primaryBuf?.length ?? 0,
          indicesBytes: indicesBuf?.length ?? 0,
        });
      }

      timing.mark('processing_started');
      const stats = computeAgronomicStatsFromPackedPngs(primaryBuf, indicesBuf, {
        sceneId,
      });
      timing.mark('ndvi_calculated', {
        mean: stats?.ndvi_mean ?? '-',
        validPixels: stats?.valid_pixel_count ?? stats?.validPixelCount ?? '-',
      });

      if (!stats) {
        timing.summary('stats_empty');
        console.warn(`⚠️ [NDVI][Process] stats agronômicas indisponíveis sceneId=${sceneId}`);
        return { preview_url: null, status: 'metadata_only' };
      }

      let contrast = {
        ...(stats.contrast || {}),
        p2: stats.ndvi_p2 ?? null,
        p5: stats.ndvi_p5 ?? null,
        p10: stats.ndvi_p10 ?? null,
        p25: stats.ndvi_p25 ?? null,
        p50: stats.ndvi_p50 ?? null,
        p75: stats.ndvi_p75 ?? null,
        p90: stats.ndvi_p90 ?? null,
        p95: stats.ndvi_p95 ?? null,
        p98: stats.ndvi_p98 ?? null,
      };
      Object.assign(contrast, resolveContrastStretch(contrast));
      const bounds = polygonToBounds(polygon);
      const rawGrid = stats._ndvi_grid ?? null;
      const gridMask = rawGrid?.values?.length
        ? maskValuesToPolygon({
            values: rawGrid.values,
            width: rawGrid.width,
            height: rawGrid.height,
            bounds,
            polygon,
          })
        : null;
      const grid = rawGrid && gridMask
        ? { ...rawGrid, values: gridMask.values, maskStats: gridMask.maskStats }
        : rawGrid;
      const rendererV2 = grid?.values?.length
        ? renderAgronomicContrastV2({
            values: grid.values,
            width: grid.width,
            height: grid.height,
            visualMode: resolvedVisual,
          })
        : null;
      if (rendererV2?.contrast) {
        contrast = {
          ...contrast,
          ...rendererV2.contrast,
          pLow: contrast.pLow,
          pHigh: contrast.pHigh,
          stretchMode: rendererV2.contrast.stretchMode ?? contrast.stretchMode,
          lowContrastScene: rendererV2.contrast.lowContrastScene,
        };
      }
      const zoneResult = grid?.values?.length
        ? buildNdviZones({
            values: grid.values,
            width: grid.width,
            height: grid.height,
            bounds,
            percentiles: contrast,
          })
        : { zones: [], spatialMetrics: { zoneCount: 0, largestLowZoneHa: null } };
      const rasterMetadata = buildNdviRasterMetadata({
        grid,
        bounds,
        rasterUrl: null,
        resolutionM: 10,
      });
      const enrichedStats = {
        ...stats,
        contrast,
        spatial_metrics: {
          ...(stats.spatial_metrics || {}),
          ...(zoneResult.spatialMetrics || {}),
        },
        rendering: stats.rendering,
        zones: zoneResult.zones,
        ...rasterMetadata,
        available_visual_modes: VISUAL_MODES,
      };

      const gridDoc = buildInternalGridDocument({
        plotId,
        sceneId,
        bounds,
        statsGrid: grid,
        primaryBuffer: primaryBuf,
        indicesBuffer: indicesBuf,
        metadata: {
          cloudPercent: null,
          acquisitionDate: date,
          rendererVersion: contrast?.rendererVersion ?? rendererV2?.contrast?.rendererVersion,
        },
      });

      let rasterPersist = null;
      if (gridDoc) {
        rasterPersist = await storeInternalGrid({
          plotId,
          sceneId,
          document: gridDoc,
        });
      }

      const persistedRaster =
        gridDoc != null
          ? { ...gridDoc, bounds, ...rasterPersist }
          : await loadInternalGrid({ plotId, sceneId, schemaVersion: RASTER_SCHEMA_NUM });

      if (!persistedRaster?.bands?.ndvi?.length) {
        return { preview_url: null, status: 'metadata_only', ...enrichedStats };
      }

      const previewGen = generatePreviewFromRaster({
        raster: persistedRaster,
        visualMode: resolvedVisual,
        polygon,
      });
      console.log('[NDVI_PREVIEW_FROM_RASTER]', {
        sceneId,
        visualMode: resolvedVisual,
        rasterReuse: false,
      });

      let colorBuf = previewGen.buffer;
      const previewBuckets = analyzePreviewColorBuckets(colorBuf);
      if (previewGen.contrast) {
        Object.assign(contrast, previewGen.contrast);
      }
      const finalStats = {
        ...enrichedStats,
        ...(previewGen.stats ?? {}),
        contrast,
        spatial_metrics:
          previewGen.stats?.spatial_metrics ??
          enrichedStats.spatial_metrics,
        rendering:
          previewGen.stats?.rendering ??
          enrichedStats.rendering,
        zones: previewGen.zones ?? zoneResult.zones,
        diagnosis: previewGen.diagnosis ?? null,
        legend: previewGen.legend ?? null,
        sourceContext: previewGen.sourceContext ?? null,
        source_context: previewGen.sourceContext ?? null,
        rendererVersion: contrast?.rendererVersion ?? null,
        renderer_version: contrast?.rendererVersion ?? null,
      };

      const preview_url = await storeNdviPreviewPng({
        farmId,
        plotId,
        sceneId,
        imageDate: date,
        visualMode: resolvedVisual,
        rendererVersion: contrast?.rendererVersion ?? 'agronomic_contrast_v2',
        buffer: colorBuf,
      });

      const colorBuckets =
        resolvedVisual === 'ndvi_contrast'
          ? contrast.colorBuckets ??
            colorBucketsForValues(
              [
                stats.ndvi_p2,
                stats.ndvi_p5,
                stats.ndvi_p10,
                stats.ndvi_p25,
                stats.ndvi_p50,
                stats.ndvi_p75,
                stats.ndvi_p90,
                stats.ndvi_p95,
                stats.ndvi_p98,
              ].filter((v) => v != null),
              contrast,
            )
          : {};
      if (
        resolvedVisual === 'ndvi_contrast' &&
        colorBuckets &&
        typeof colorBuckets === 'object'
      ) {
        contrast.colorBuckets = colorBuckets;
        Object.assign(finalStats, colorBuckets);
      }
      console.log(
        `[NDVI_RENDER_V2] sceneId=${sceneId} visualMode=${resolvedVisual} ` +
          `p5=${contrast.p5 ?? '-'} p50=${contrast.p50 ?? '-'} p95=${contrast.p95 ?? '-'} ` +
          `range=${Number.isFinite(contrast.pLow) && Number.isFinite(contrast.pHigh) ? (contrast.pHigh - contrast.pLow).toFixed(3) : '-'} ` +
          `gamma=${contrast.gamma ?? '-'} lowContrastScene=${contrast.lowContrastScene} colorBuckets=${JSON.stringify(colorBuckets)}`,
      );
      console.log('[NDVI_RENDER_V2_FINAL]', {
        visualMode: resolvedVisual,
        p5: contrast.p5 ?? null,
        p50: contrast.p50 ?? null,
        p95: contrast.p95 ?? null,
        validPixelCount:
          previewGen.maskStats?.validPixels ?? grid?.maskStats?.validPixels ?? null,
        range:
          Number.isFinite(contrast.pLow) && Number.isFinite(contrast.pHigh)
            ? Number((contrast.pHigh - contrast.pLow).toFixed(3))
            : null,
        rendererVersion: contrast.rendererVersion ?? null,
        alphaOutsidePolygon: true,
        colorBuckets,
        usedPercentileStretch:
          Number.isFinite(contrast.pLow) && Number.isFinite(contrast.pHigh),
      });
      console.log(
        `[NDVI_RASTER_STORE] sceneId=${sceneId} rasterFormat=${rasterMetadata.raster_format ?? '-'} ` +
          `bands=${JSON.stringify(rasterMetadata.raster_bands)} rasterAvailable=${rasterMetadata.raster_available} ` +
          `rasterUrl=${rasterMetadata.raster_url ?? '-'}`,
      );
      console.log(
        `[NDVI_ZONE_BUILDER] zoneCount=${zoneResult.zones.length} ` +
          `percentBelowP25=${enrichedStats.spatial_metrics?.percentBelowP25 ?? '-'} ` +
          `largestLowZoneHa=${enrichedStats.spatial_metrics?.largestLowZoneHa ?? '-'} ` +
          `homogeneityScore=${enrichedStats.spatial_metrics?.homogeneityScore ?? '-'}`,
      );

      timing.mark('raster_saved', {
        rasterAvailable: Boolean(
          rasterPersist?.raster_storage_key ?? rasterPersist?.storageKey,
        ),
        preview: preview_url ? 'yes' : 'no',
      });
      timing.mark('response_ready');
      timing.summary(preview_url ? 'success' : 'metadata_only');

      return {
        preview_url,
        tile_url: null,
        raster_url: rasterPersist?.rasterUrl ?? rasterMetadata.raster_url,
        raster_format: 'internal_grid',
        raster_bands: rasterMetadata.raster_bands,
        raster_bounds: rasterMetadata.raster_bounds,
        raster_resolution_m: rasterMetadata.raster_resolution_m,
        raster_available: Boolean(rasterPersist?.raster_storage_key ?? rasterPersist?.storageKey),
        raster_storage_key: rasterPersist?.raster_storage_key ?? null,
        raster_storage_provider: rasterPersist?.raster_storage_provider ?? null,
        raster_schema_version: rasterPersist?.raster_schema_version ?? RASTER_SCHEMA_NUM,
        bounds,
        visual_mode: resolvedVisual,
        colormap_mode: resolvedVisual,
        processing_engine: 'copernicus_process_api',
        provider: 'copernicus_dataspace',
        source: 'sentinel-2-l2a',
        status: preview_url ? 'generated' : 'metadata_only',
        polygon_masked: true,
        available_visual_modes: VISUAL_MODES,
        contrast,
        spatial_metrics: finalStats.spatial_metrics,
        rendering: finalStats.rendering,
        zones: finalStats.zones,
        diagnosis: previewGen.diagnosis ?? null,
        legend: previewGen.legend ?? null,
        sourceContext: previewGen.sourceContext ?? null,
        source_context: previewGen.sourceContext ?? null,
        rendererVersion: contrast?.rendererVersion ?? null,
        renderer_version: contrast?.rendererVersion ?? null,
        cacheTag: previewGen.sourceContext
          ? `${plotId}|${sceneId}|${resolvedVisual}|${contrast?.rendererVersion ?? 'unknown'}|scl_v2|stats_v2_inner_pixel_buffer`
          : null,
        cache_tag: previewGen.sourceContext
          ? `${plotId}|${sceneId}|${resolvedVisual}|${contrast?.rendererVersion ?? 'unknown'}|scl_v2|stats_v2_inner_pixel_buffer`
          : null,
        stats: finalStats,
        classes: stats.classes,
        ...finalStats,
      };
    } catch (error) {
      console.warn(`⚠️ [NDVI][Process] falha sceneId=${sceneId}: ${error.message}`);
      return { preview_url: null, status: 'metadata_only' };
    }
  }

  async _generateSurfaceCoverLayer({
    token,
    polygon,
    date,
    sceneId,
    farmId,
    plotId,
    visualMode,
  }) {
    const rendererVersion = `${SURFACE_COVER_ALGORITHM}_${visualMode}`;
    try {
      const [packedBuf, previewBuf] = await Promise.all([
        this._postProcessPng({
          token,
          polygon,
          date,
          evalscript: buildSurfaceCoverPackedEvalscript(),
          width: 256,
          height: 256,
          sceneId,
          label: 'surface_cover_packed',
        }),
        this._postProcessPng({
          token,
          polygon,
          date,
          evalscript: buildSurfaceCoverPreviewEvalscript(),
          width: 512,
          height: 512,
          sceneId,
          label: 'surface_cover_preview',
        }),
      ]);

      const coverStats = packedBuf
        ? computeSurfaceCoverStatsFromPackedPng(packedBuf, { resolutionM: 20 })
        : null;
      if (!coverStats || coverStats.status !== 'ok' || !previewBuf) {
        console.warn(
          `⚠️ [NDVI][SurfaceCover] indisponível sceneId=${sceneId} packed=${Boolean(packedBuf)} preview=${Boolean(previewBuf)} status=${coverStats?.status || '-'}`,
        );
        return { preview_url: null, status: 'metadata_only', visual_mode: visualMode };
      }

      const bounds = polygonToBounds(polygon);
      const preview_url = await storeNdviPreviewPng({
        farmId,
        plotId,
        sceneId,
        imageDate: date,
        visualMode,
        rendererVersion,
        buffer: previewBuf,
      });

      const agronomic = {
        schema_version: SURFACE_COVER_ALGORITHM,
        visual_mode: visualMode,
        renderType: 'categorical',
        selectedBand: 'SURFACE_CLASS',
        rendererVersion,
        renderer_version: rendererVersion,
        classAreas: coverStats.classAreas,
        classAreaStatus: coverStats.status,
        dominantClass: coverStats.dominantClass,
        validPixelCount: coverStats.validPixelCount,
        validAreaHa: coverStats.validAreaHa,
        meanConfidence: coverStats.meanConfidence,
        bare_soil_percent: coverStats.bare_soil_percent,
        straw_percent: coverStats.straw_percent,
        green_residual_percent: coverStats.green_residual_percent,
        vegetation_cover_percent: coverStats.vegetation_cover_percent,
        inconclusive_percent: coverStats.inconclusive_percent,
        dataQuality: 'estimated',
        algorithmVersion: SURFACE_COVER_ALGORITHM,
      };

      return {
        preview_url,
        tile_url: null,
        bounds,
        visual_mode: visualMode,
        colormap_mode: visualMode,
        processing_engine: 'copernicus_process_api',
        provider: 'copernicus_dataspace',
        source: 'sentinel-2-l2a',
        status: preview_url ? 'generated' : 'metadata_only',
        rendererVersion,
        renderer_version: rendererVersion,
        renderType: 'categorical',
        selectedBand: 'SURFACE_CLASS',
        classAreas: coverStats.classAreas,
        classAreaStatus: coverStats.status,
        dominantClass: coverStats.dominantClass,
        validPixelCount: coverStats.validPixelCount,
        validAreaHa: coverStats.validAreaHa,
        meanConfidence: coverStats.meanConfidence,
        stats: agronomic,
        agronomic_stats: agronomic,
        ...agronomic,
      };
    } catch (error) {
      console.warn(
        `⚠️ [NDVI][SurfaceCover] falha sceneId=${sceneId}: ${error.message}`,
      );
      return { preview_url: null, status: 'metadata_only', visual_mode: visualMode };
    }
  }

  _mockAssets({ farmId, plotId, imageDate }) {
    const prefix = this.publicBaseUrl || 'https://dummyimage.com';
    const stamp = String(imageDate || '').replace(/-/g, '');
    const stats = {
      ndvi_mean: 0.62,
      ndvi_min: 0.28,
      ndvi_max: 0.81,
      ndvi_std: 0.09,
      ndvi_p10: 0.35,
      ndvi_p25: 0.48,
      ndvi_p50: 0.61,
      ndvi_p75: 0.72,
      ndvi_p90: 0.78,
      ndre_mean: 0.38,
      savi_mean: 0.55,
      bsi_mean: 0.12,
      ndmi_mean: 0.18,
      water_percent: 2,
      bare_soil_percent: 8,
      straw_percent: 6,
      low_vigor_percent: 12,
      medium_vigor_percent: 28,
      high_vigor_percent: 32,
      very_high_vigor_percent: 10,
      stress_candidate_percent: 2,
      very_low_percent: 10,
      low_percent: 18,
      medium_percent: 28,
      high_percent: 42,
      classes: {
        bareSoilPercent: 8,
        strawPercent: 6,
        lowVigorPercent: 12,
        mediumVigorPercent: 28,
        highVigorPercent: 32,
        veryHighVigorPercent: 10,
        stressCandidatePercent: 2,
        waterPercent: 2,
      },
    };
    return {
      preview_url: `${prefix}/1024x768/2e7d32/ffffff.png&text=NDVI+${plotId}+${stamp}`,
      raster_url: `${prefix}/1200x900/1b5e20/ffffff.png&text=NDVI+RASTER+${plotId}`,
      visual_mode: 'ndvi_contrast',
      available_visual_modes: VISUAL_MODES,
      contrast: {
        p2: 0.3,
        p5: 0.35,
        p10: 0.4,
        p25: 0.48,
        p50: 0.61,
        p75: 0.72,
        p90: 0.76,
        p95: 0.78,
        p98: 0.8,
        std: 0.09,
        lowContrastScene: false,
        stretchMode: 'p5_p95',
        rendererVersion: 'agronomic_contrast_v2',
        equalization: {
          enabled: true,
          method: 'clahe_light',
          clipLimit: 2.5,
        },
        smoothing: {
          enabled: true,
          median3x3: true,
          interpolation: 'bilinear_4x',
        },
        colorBuckets: {
          redPercent: 8,
          orangePercent: 12,
          yellowPercent: 18,
          lightGreenPercent: 25,
          greenPercent: 24,
          darkGreenPercent: 13,
        },
      },
      spatial_metrics: {
        homogeneityScore: 72,
        contrastScore: 28,
        contrastSeverity: 'low',
        percentBelowP25: 18,
        percentAboveP75: 22,
        ndviRange: 0.43,
        coefficientOfVariation: 0.14,
        entropy: 0.62,
        zoneCount: 3,
        largestLowZoneHa: 0.4,
      },
      raster_available: false,
      raster_format: null,
      raster_bands: [],
      raster_bounds: null,
      raster_resolution_m: 10,
      processing_engine: 'copernicus_process_api',
      provider: 'copernicus_dataspace',
      source: 'sentinel-2-l2a',
      status: 'generated',
      stats,
      classes: stats.classes,
      ...stats,
    };
  }
}

export default SentinelProcessClient;
