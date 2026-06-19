import { createHash, randomUUID } from 'node:crypto';
import NdviStatsService from './ndviStats.service.js';
import * as NdviResponseMapper from './ndviResponse.mapper.js';
import { assertCopernicusReady, getNdviProviderStatus } from './ndviEnv.js';
import {
  logGenerateFail,
  logGenerateOk,
  logGenerateStage,
  logGenerateStart,
} from './ndviGenerateLogger.js';
import { isPlaceholderPreviewUrl } from './ndviPngStats.js';
import {
  dedupeScenesByDate,
  enrichScenesFromLayers,
  formatSceneForApi,
  logScenesSummary,
  sortScenesForDisplay,
} from './ndviScenePipeline.js';
import {
  invalidNdviStatsReason,
  isValidNdviLayerRow,
  isValidNdviStats,
  layerHasRaster,
} from './ndviValidity.js';
import { buildNdviTemporalIntelligence } from './ndviTemporalIntelligenceEngine.js';
import {
  layerMeetsContrastContract,
  resolveRequestedVisualMode,
  validateNdviContrastHttpResponse,
} from './ndviContrastHttpValidity.js';
import { assertVisualModeSupported } from './ndviVisualModeGate.js';
import { loadInternalGrid } from './ndviRasterStore.js';
import { RASTER_SCHEMA_NUM } from './ndviRasterSerializer.js';

function normalizeImageDate(value) {
  if (value == null) return null;
  const text = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

function imageDateFromSentinelSceneId(sceneId) {
  const text = String(sceneId || '').trim();
  const match = text.match(/MSIL2A_(\d{4})(\d{2})(\d{2})T/i);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function resolveSceneAcquisitionDate({ sceneId, imageDate }) {
  const fromSceneId = imageDateFromSentinelSceneId(sceneId);
  const normalizedImageDate = normalizeImageDate(imageDate);
  return fromSceneId || normalizedImageDate;
}

const PACKAGE_MODE_PRIORITY = Object.freeze([
  'ndvi_contrast',
  'ndvi_absolute',
  'agronomic_classes',
  'ndvi_relative',
  'ndmi_water_stress',
  'ndre',
  'bsi_soil',
]);

function orderPackageModes(modes) {
  const priority = new Map(PACKAGE_MODE_PRIORITY.map((mode, index) => [mode, index]));
  return [...modes].sort((left, right) => {
    const leftPriority = priority.has(left) ? priority.get(left) : PACKAGE_MODE_PRIORITY.length;
    const rightPriority = priority.has(right) ? priority.get(right) : PACKAGE_MODE_PRIORITY.length;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return String(left).localeCompare(String(right));
  });
}

function hashPolygonForPackage(polygon) {
  const coordinates = polygon?.coordinates?.[0];
  const raw = Array.isArray(coordinates) && coordinates.length
    ? coordinates
        .map((point) => `${Number(point?.[0]).toFixed(6)},${Number(point?.[1]).toFixed(6)}`)
        .join('|')
    : JSON.stringify(polygon || {});
  return createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

function buildScenePackageKey({
  farmId,
  plotId,
  sceneId,
  acquisitionDate,
  polygonHash,
  resolutionKind = 'preview',
  cloudMaskVersion = 'scl_v2',
  rendererVersion = 'agronomic_contrast_v7_inner_buffer',
}) {
  return [
    farmId,
    plotId,
    sceneId || '-',
    acquisitionDate || '-',
    polygonHash || '-',
    resolutionKind,
    cloudMaskVersion,
    rendererVersion,
  ].join('_');
}

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizePackageModeError(mode, error) {
  const rawCode = error?.code || 'layer_generation_failed';
  const rawMessage = error?.message || String(error);
  const status = error?.status === 422 ? 'unavailable' : 'failed';
  const out = {
    status,
    code: rawCode,
    message: rawMessage,
    sourceBands: sourceBandsForMode(mode),
    missingBands: Array.isArray(error?.details?.missingBands)
      ? error.details.missingBands
      : [],
  };

  if (
    rawCode === 'missingBands' ||
    rawCode === 'missing_bands' ||
    out.missingBands.length > 0
  ) {
    out.status = 'unavailable';
    if (mode === 'ndre') {
      out.code =
        /b8a/i.test(rawMessage) || out.missingBands.includes('B8A')
          ? 'missingBandB8A'
          : 'missingBandB05';
      out.message = /banda/i.test(rawMessage)
        ? rawMessage
        : 'Banda B05/B8A ausente para Red Edge.';
    } else if (mode === 'ndmi_water_stress') {
      out.code = 'missingBandB11';
      out.message = /banda/i.test(rawMessage)
        ? rawMessage
        : 'Banda B11 ausente para Umidade.';
    } else if (mode === 'bsi_soil') {
      out.code = 'missingRequiredSoilPlantBand';
      out.message = /banda/i.test(rawMessage)
        ? rawMessage
        : 'Banda B04/B08/B11 ausente para Solo/Palhada.';
    }
  } else if (rawCode === 'NDVI_PROVIDER_ERROR' || rawCode === 'ndvi_provider_error') {
    if (mode === 'ndre') {
      out.code = 'redEdgeProviderError';
      out.message = rawMessage.includes('NDVI')
        ? 'Não foi possível gerar Red Edge/NDRE no provedor de imagens.'
        : rawMessage;
    } else if (mode === 'ndmi_water_stress') {
      out.code = 'moistureProviderError';
      out.message = rawMessage.includes('NDVI')
        ? 'Não foi possível gerar Umidade/NDMI no provedor de imagens.'
        : rawMessage;
    } else if (mode === 'bsi_soil') {
      out.code = 'soilPlantProviderError';
      out.message = rawMessage.includes('NDVI')
        ? 'Não foi possível gerar Solo/Palhada no provedor de imagens.'
        : rawMessage;
    } else {
      out.code = 'ndviProviderError';
    }
  }

  return out;
}

function sourceBandsForMode(mode) {
  switch (mode) {
    case 'ndmi_water_stress':
      return ['B08', 'B11'];
    case 'ndre':
      return ['B8A', 'B05'];
    case 'bsi_soil':
      return ['B04', 'B08', 'B11'];
    case 'ndvi_contrast':
    case 'ndvi_absolute':
    case 'ndvi_relative':
    case 'agronomic_classes':
    default:
      return ['B04', 'B08'];
  }
}

function hasCoreRenderableNdviStats(stats) {
  if (!stats || typeof stats !== 'object') return false;
  const mean = num(stats.ndvi_mean ?? stats.ndviMean);
  const min = num(stats.ndvi_min ?? stats.ndviMin);
  const max = num(stats.ndvi_max ?? stats.ndviMax);
  const p5 = num(stats.ndvi_p5 ?? stats.ndviP5 ?? stats.contrast?.p5);
  const p50 = num(stats.ndvi_p50 ?? stats.ndviP50 ?? stats.contrast?.p50);
  const p95 = num(stats.ndvi_p95 ?? stats.ndviP95 ?? stats.contrast?.p95);
  const validPixels = num(
    stats.validPixelCount ?? stats.valid_pixel_count ?? stats.valid_pixels,
  );
  if ([mean, min, max, p5, p50, p95].some((value) => value == null)) {
    return false;
  }
  if (mean < -1 || mean > 1 || min < -1 || max > 1 || min > mean || mean > max) {
    return false;
  }
  if (p5 > p50 || p50 > p95) return false;
  if (validPixels != null && validPixels < 24) return false;
  return true;
}

function resolvePackageStatus(layersByMode = {}, statusesByMode = {}) {
  const readyCount = Object.keys(layersByMode).length;
  const statuses = Object.values(statusesByMode);
  const failedCount = statuses.filter((status) => status?.status === 'failed').length;
  const unavailableCount = statuses.filter(
    (status) => status?.status === 'unavailable',
  ).length;
  if (readyCount > 0 && failedCount === 0 && unavailableCount === 0) return 'ready';
  if (readyCount > 0) return 'partial';
  if (unavailableCount > 0 && failedCount === 0) return 'unavailable';
  if (failedCount > 0) return 'failed';
  return 'failed';
}

class SoilSamplingNdviService {
  constructor({ repository, catalogClient, processClient, authClient, geeClient = null }) {
    this.repository = repository;
    this.catalogClient = catalogClient;
    this.processClient = processClient;
    this.authClient = authClient;
    this.geeClient = geeClient;
  }

  /** GEE dormente por padrão; só usa com opt-in explícito para evitar custo. */
  _geeReady({ packageMode = false } = {}) {
    const providerStatus = getNdviProviderStatus();
    const requested = packageMode
      ? providerStatus.gee_package_preferred
      : providerStatus.gee_primary;
    return Boolean(requested && this.geeClient?.isImplemented?.());
  }

  _logRequest(meta) {
    const bbox = meta.polygon ? this.catalogClient.polygonToBbox(meta.polygon) : null;
    console.log(
      `ℹ️ [NDVI] request op=${meta.op} plotId=${meta.plotId} farmId=${meta.farmId} ` +
        `campaignId=${meta.campaignId || '-'} start=${meta.startDate || '-'} ` +
        `end=${meta.endDate || '-'} max_cloud=${meta.maxCloud ?? 20}` +
        (bbox ? ` bbox=${bbox.join(',')}` : ''),
    );
  }

  async _tryEnsureSchema(context = 'ndvi') {
    try {
      await this.repository.ensureSchema();
      return true;
    } catch (error) {
      console.warn(`⚠️ [NDVI] ensureSchema indisponível (${context}): ${error.message}`);
      return false;
    }
  }

  _hasRenderableAssets(assets) {
    if (isPlaceholderPreviewUrl(assets?.preview_url)) return false;
    return Boolean(assets?.preview_url || assets?.tile_url || assets?.raster_url);
  }

  _isLayerResponseReady(row) {
    return isValidNdviLayerRow(row);
  }

  _assertReadyLayerOrThrow(mapped, meta) {
    if (this._isLayerResponseReady(mapped)) return;
    throw this._error(
      'NDVI não foi calculado com estatísticas válidas.',
      'ndvi_not_computed',
      422,
      {
        plotId: meta.plotId,
        sceneId: meta.sceneId,
        preview: mapped?.preview_url ? 'yes' : 'no',
        ndviMean: mapped?.ndvi_mean,
      },
    );
  }

  _buildEphemeralLayerRow({
    layerId,
    farmId,
    plotId,
    campaignId,
    targetSceneId,
    targetDate,
    targetCloud,
    layerStatus,
    stats,
    assets,
    bounds = null,
    requestedVisualMode = 'ndvi_contrast',
  }) {
    return {
      id: layerId,
      scene_id: String(targetSceneId),
      farm_id: String(farmId),
      plot_id: String(plotId),
      campaign_id: campaignId != null ? String(campaignId) : null,
      source: 'sentinel_2_l2a',
      image_date: targetDate,
      cloud_coverage: targetCloud,
      resolution_m: 10,
      ...stats,
      visual_mode: assets?.visual_mode ?? requestedVisualMode,
      schema_version: 'ndvi_v3',
      ndvi_schema_version: 3,
      is_legacy_schema: false,
      agronomic_stats: {
        ...stats,
        schema_version: 'ndvi_v3',
        ndvi_schema_version: 3,
        contrast: assets?.contrast ?? stats?.contrast,
        classes: assets?.classes ?? stats?.classes,
        visual_mode: assets?.visual_mode ?? requestedVisualMode,
        bounds,
        renderer_version: assets?.contrast?.rendererVersion ?? null,
        spatial_metrics: assets?.spatial_metrics ?? stats?.spatial_metrics,
        zones: assets?.zones ?? stats?.zones ?? [],
        raster_available: assets?.raster_available ?? false,
        raster_format: assets?.raster_format ?? null,
        raster_bands: assets?.raster_bands ?? [],
        raster_bounds: assets?.raster_bounds ?? bounds,
        raster_resolution_m: assets?.raster_resolution_m ?? 10,
      },
      preview_url: assets.preview_url ?? null,
      tile_url: assets.tile_url ?? null,
      raster_url: assets.raster_url ?? null,
      is_active: false,
      status: layerStatus,
    };
  }

  _boundsFromPolygon(polygon) {
    const bbox = this.catalogClient.polygonToBbox?.(polygon);
    if (!Array.isArray(bbox) || bbox.length < 4) return null;
    return {
      west: Number(bbox[0]),
      south: Number(bbox[1]),
      east: Number(bbox[2]),
      north: Number(bbox[3]),
    };
  }

  _mergeMappedLayerFromAssets(mapped, assets, { polygon, requestedVisualMode }) {
    if (!mapped) return mapped;
    const requestBounds = this._boundsFromPolygon(polygon);
    const bounds =
      requestBounds ?? assets?.bounds ?? mapped.bounds;
    const contrast = assets?.contrast ?? mapped.contrast;
    const visualMode =
      assets?.visual_mode ?? mapped.visual_mode ?? requestedVisualMode;

    mapped.visual_mode = visualMode;
    mapped.visualMode = visualMode;
    if (requestedVisualMode === 'ndvi_contrast' && assets) {
      mapped.schema_version = 'ndvi_v3';
      mapped.schemaVersion = 'ndvi_v3';
      mapped.ndvi_schema_version = 3;
      mapped.ndviSchemaVersion = 3;
      mapped.is_legacy_schema = false;
      mapped.isLegacySchema = false;
      mapped.isLegacy = false;
      mapped.status = 'ready';
    }
    if (contrast) mapped.contrast = contrast;
    if (bounds) {
      mapped.bounds = bounds;
      mapped.preview_bounds = bounds;
      mapped.bbox = [bounds.west, bounds.south, bounds.east, bounds.north];
    }
    if (assets?.available_visual_modes) {
      mapped.available_visual_modes = assets.available_visual_modes;
    }
    if (assets?.colormap_mode) mapped.colormap_mode = assets.colormap_mode;
    if (assets?.processing_engine) {
      mapped.processing_engine = assets.processing_engine;
    }
    mapped.provider_used = assets?.provider_used ?? assets?.provider ?? mapped.provider;
    if (assets?.classes) mapped.classes = assets.classes;
    if (assets?.stats) mapped.stats = { ...mapped.stats, ...assets.stats, contrast };
    return mapped;
  }

  _assertContrastContractOrThrow(mapped, meta, { requestedVisualMode, polygon }) {
    const validation = validateNdviContrastHttpResponse(mapped, requestedVisualMode, {
      requestBounds: this._boundsFromPolygon(polygon),
    });
    if (validation.ok) return;
    throw this._error(
      'NDVI contrastado não foi gerado com contrato v3 completo.',
      'ndvi_contrast_not_computed',
      422,
      {
        plotId: meta.plotId,
        sceneId: meta.sceneId,
        requestedVisualMode,
        resultVisualMode: validation.resultVisualMode,
        schemaVersion: validation.schemaVersion,
        schemaOk: validation.schemaOk,
        isLegacy: validation.legacy,
        hasPreview: validation.hasPreview,
        hasContrast: validation.hasContrast,
        hasBounds: validation.hasBounds,
        boundsMatchRequest: validation.boundsMatchRequest,
        p5: validation.contrast?.p5 ?? null,
        p50: validation.contrast?.p50 ?? null,
        p95: validation.contrast?.p95 ?? null,
      },
    );
  }

  async searchScenes({
    farmId,
    plotId,
    campaignId,
    polygon,
    startDate,
    endDate,
    maxCloud = 20,
  }) {
    this._requireScope({ farmId, plotId });
    if (!campaignId) {
      throw this._error('campaign_id é obrigatório', 'campaign_required', 400);
    }
    if (!startDate || !endDate) {
      throw this._error('Período inválido para busca NDVI', 'invalid_date_range', 400);
    }
    if (!polygon || polygon.type !== 'Polygon') {
      throw this._error('Polígono do talhão é obrigatório', 'plot_polygon_missing', 400);
    }

    this._logRequest({
      op: 'searchScenes',
      farmId,
      plotId,
      campaignId,
      polygon,
      startDate,
      endDate,
      maxCloud,
    });

    const started = Date.now();
    await this._tryEnsureSchema('searchScenes');

    let rawScenes;
    let scenesProvider = 'copernicus_dataspace';
    if (this._geeReady()) {
      try {
        rawScenes = await this.geeClient.searchScenes({
          polygon,
          startDate,
          endDate,
          maxCloud,
        });
        scenesProvider = 'google_earth_engine';
      } catch (error) {
        console.warn(
          `⚠️ [NDVI] GEE search falhou, fallback Copernicus: ${error?.message || error}`,
        );
      }
    }
    if (!rawScenes) {
      try {
        rawScenes = await this.catalogClient.searchSentinelScenes({
          polygon,
          startDate,
          endDate,
          maxCloud,
        });
      } catch (error) {
        throw this._providerError(error, 'Falha ao buscar cenas Sentinel no provedor NDVI');
      }
    }

    let layers = [];
    try {
      layers = await this.repository.listByPlot({ farmId, plotId });
    } catch (layerError) {
      console.warn(
        `⚠️ [NDVI] listByPlot ignorado plotId=${plotId}: ${layerError.message}`,
      );
    }

    const deduped = dedupeScenesByDate(rawScenes);
    const enriched = enrichScenesFromLayers(deduped, layers);
    const sorted = sortScenesForDisplay(enriched);
    const scenes = sorted.map((scene) => formatSceneForApi(scene));

    logScenesSummary({ plotId, farmId, scenes });

    console.log(
      `✅ [NDVI] searchScenes plotId=${plotId} raw=${rawScenes.length} ` +
        `deduped=${scenes.length} provider=${scenesProvider} elapsedMs=${Date.now() - started}`,
    );
    return scenes;
  }

  async listPlotLayers({ farmId, plotId }) {
    this._requireScope({ farmId, plotId });
    await this.repository.ensureSchema();
    const rows = await this.repository.listByPlot({ farmId, plotId });
    const temporal = buildNdviTemporalIntelligence(
      rows.map((row) => ({
        ...row,
        ...(row.agronomic_stats || {}),
      })),
    );
    return rows
      .map((row) =>
        NdviResponseMapper.mapLayer({
          ...row,
          agronomic_stats: {
            ...(row.agronomic_stats || {}),
            temporal_intelligence: temporal,
          },
        }),
      )
      .filter(Boolean);
  }

  async listScenes({ farmId, plotId, startDate, endDate, maxCloud, polygon = null }) {
    if (!polygon) {
      console.warn(
        `⚠️ [NDVI] listScenes sem polygon plotId=${plotId} — use POST /scenes/search`,
      );
      return [];
    }
    return this.searchScenes({
      farmId,
      plotId,
      campaignId: 'legacy',
      polygon,
      startDate,
      endDate,
      maxCloud,
    });
  }

  async _persistGeneratedLayer({
    dbReady,
    farmId,
    plotId,
    campaignId,
    targetSceneId,
    targetDate,
    targetCloud,
    assets,
    stats,
    layerStatus,
    polygon,
    requestedVisualMode,
    meta,
    stage = 'persist',
  }) {
    const layerId = randomUUID();
    const plotBounds = this._boundsFromPolygon(polygon);
    if (!plotBounds) {
      throw this._error(
        'Bounds do talhão não puderam ser calculados a partir do polígono.',
        'invalid_polygon_bounds',
        422,
        { plotId, sceneId: targetSceneId },
      );
    }
    let saved = null;

    if (dbReady) {
      try {
        saved = await this.repository.upsertLayer({
          id: layerId,
          scene_id: String(targetSceneId),
          farm_id: farmId,
          plot_id: plotId,
          campaign_id: campaignId,
          source: assets.source || 'sentinel-2_l2a',
          image_date: targetDate,
          cloud_coverage: targetCloud,
          resolution_m: 10,
          ...stats,
          agronomic_stats: {
            ...stats,
            schema_version: 'ndvi_v3',
            ndvi_schema_version: 3,
            contrast: assets.contrast ?? stats.contrast,
            classes: assets.classes ?? stats.classes,
            visual_mode: assets.visual_mode ?? requestedVisualMode,
            bounds: plotBounds,
            renderer_version:
              assets?.rendererVersion ??
              assets?.renderer_version ??
              assets?.contrast?.rendererVersion ??
              null,
            zones: assets.zones ?? stats.zones ?? [],
            spatial_metrics: assets.spatial_metrics ?? stats.spatial_metrics,
            rendering: assets.rendering ?? stats.rendering,
            diagnosis: assets.diagnosis ?? stats.diagnosis ?? null,
            legend: assets.legend ?? stats.legend ?? null,
            sourceContext: assets.sourceContext ?? stats.sourceContext ?? null,
            source_context: assets.source_context ?? stats.source_context ?? null,
            cacheHit: assets.cacheHit ?? assets.cache_hit ?? false,
            cacheTag: assets.cacheTag ?? assets.cache_tag ?? null,
            generatedAt: assets.generatedAt ?? assets.generated_at ?? null,
            raster_available: assets.raster_available ?? false,
            raster_format: assets.raster_format ?? null,
            raster_bands: assets.raster_bands ?? [],
            raster_bounds: assets.raster_bounds ?? plotBounds,
            raster_resolution_m: assets.raster_resolution_m ?? 10,
            raster_storage_key: assets.raster_storage_key ?? null,
            raster_storage_provider: assets.raster_storage_provider ?? null,
            raster_schema_version: assets.raster_schema_version ?? null,
          },
          schema_version: 'ndvi_v3',
          ndvi_schema_version: 3,
          is_legacy_schema: false,
          visual_mode: assets.visual_mode ?? requestedVisualMode,
          processing_engine: assets.processing_engine ?? 'copernicus_process_api',
          provider: assets.provider ?? 'copernicus_dataspace',
          preview_url: assets.preview_url,
          tile_url: assets.tile_url,
          raster_url: assets.raster_url ?? null,
          raster_format: assets.raster_format ?? null,
          raster_bands: assets.raster_bands ?? [],
          raster_bounds: assets.raster_bounds ?? plotBounds,
          raster_resolution_m: assets.raster_resolution_m ?? 10,
          raster_available: assets.raster_available ?? false,
          raster_storage_key: assets.raster_storage_key ?? null,
          raster_storage_provider: assets.raster_storage_provider ?? null,
          raster_schema_version: assets.raster_schema_version ?? null,
          is_active: false,
          status: layerStatus,
        });
      } catch (persistError) {
        console.error(
          `❌ [NDVI] upsertLayer plotId=${plotId} sceneId=${targetSceneId}: ${persistError.message}`,
        );
        if (this._hasRenderableAssets(assets)) {
          console.warn(
            `⚠️ [NDVI] retornando camada efêmera (persist falhou) plotId=${plotId}`,
          );
          saved = this._buildEphemeralLayerRow({
            layerId,
            farmId,
            plotId,
            campaignId,
            targetSceneId,
            targetDate,
            targetCloud,
            layerStatus,
            stats,
            assets,
            bounds: plotBounds,
            requestedVisualMode,
          });
        } else {
          throw this._error(
            'Não foi possível salvar a camada NDVI no banco',
            'layer_persist_failed',
            503,
            {
              stage,
              pg_code: persistError.code,
              hint: persistError.hint,
            },
          );
        }
      }
    } else if (this._hasRenderableAssets(assets)) {
      console.warn(
        `⚠️ [NDVI] retornando camada efêmera (banco indisponível) plotId=${plotId}`,
      );
      saved = this._buildEphemeralLayerRow({
        layerId,
        farmId,
        plotId,
        campaignId,
        targetSceneId,
        targetDate,
        targetCloud,
        layerStatus,
        stats,
        assets,
        bounds: plotBounds,
        requestedVisualMode,
      });
    } else {
      throw this._error(
        'Banco NDVI indisponível e nenhuma imagem foi gerada pelo provedor',
        'ndvi_database_unavailable',
        503,
        { stage },
      );
    }

    let mapped = NdviResponseMapper.mapLayer(saved);
    if (!mapped) {
      throw this._error(
        'Camada NDVI salva mas resposta inválida',
        'invalid_layer_response',
        500,
        { stage, layer_id: saved?.id },
      );
    }

    mapped = this._mergeMappedLayerFromAssets(mapped, assets, {
      polygon,
      requestedVisualMode,
    });

    this._assertReadyLayerOrThrow(mapped, meta);
    this._assertContrastContractOrThrow(mapped, meta, {
      requestedVisualMode,
      polygon,
    });
    return mapped;
  }

  async _readCachedPackageLayers({
    dbReady,
    farmId,
    plotId,
    imageDate,
    sceneId,
    maxCloud,
    polygon,
    modes,
  }) {
    const layersByMode = {};
    const statusesByMode = {};
    if (!dbReady || !this.repository?.findRecentCache) {
      return { layersByMode, statusesByMode };
    }

    for (const mode of modes) {
      const startedAt = Date.now();
      console.log('[NDVI] render cache lookup', {
        plotId,
        sceneId,
        mode,
      });
      try {
        const cached = await this.repository.findRecentCache({
          farmId,
          plotId,
          imageDate,
          sceneId,
          maxCloud,
          visualMode: mode,
        });
        if (!cached || !isValidNdviLayerRow(cached)) {
          console.log('[NDVI] render cache miss', {
            plotId,
            sceneId,
            mode,
            reason: cached ? invalidNdviStatsReason(cached) : 'not_found',
          });
          continue;
        }
        let mapped = NdviResponseMapper.mapLayer(cached);
        const contractOk = layerMeetsContrastContract(mapped, mode, {
          requestBounds: this._boundsFromPolygon(polygon),
        });
        if (!contractOk) {
          console.log('[NDVI] render cache miss', {
            plotId,
            sceneId,
            mode,
            reason: 'contract_mismatch',
          });
          continue;
        }
        mapped = this._mergeMappedLayerFromAssets(mapped, null, {
          polygon,
          requestedVisualMode: mode,
        });
        layersByMode[mode] = mapped;
        statusesByMode[mode] = {
          status: 'ready',
          elapsedMs: Date.now() - startedAt,
          preview: Boolean(mapped?.preview_url || mapped?.previewUrl),
          source: 'render_cache',
          sourceBands: sourceBandsForMode(mode),
        };
        console.log(`[NDVI_LAYER] READY mode=${mode}`, statusesByMode[mode]);
        console.log('[NDVI] render cache hit', {
          plotId,
          sceneId,
          mode,
          elapsedMs: Date.now() - startedAt,
        });
      } catch (error) {
        console.warn('[NDVI] render cache lookup failed', {
          plotId,
          sceneId,
          mode,
          message: error?.message || String(error),
        });
      }
    }

    return { layersByMode, statusesByMode };
  }

  async generateLayerPackage({
    farmId,
    plotId,
    campaignId = null,
    sceneId,
    polygon,
    imageDate,
    cloudCoverage = null,
    startDate = null,
    endDate = null,
    maxCloud = null,
    colormapMode = 'auto',
    modes = null,
    force = false,
  }) {
    const defaultModes = [
      'ndvi_contrast',
      'ndvi_absolute',
      'agronomic_classes',
      'ndvi_relative',
      'ndmi_water_stress',
      'ndre',
      'bsi_soil',
    ];
    const requestedModes = Array.isArray(modes) && modes.length
      ? modes.map((mode) => resolveRequestedVisualMode(mode)).filter(Boolean)
      : defaultModes;
    const uniqueModes = orderPackageModes([...new Set(requestedModes)]);
    const startedAt = Date.now();
    const layersByMode = {};
    const statusesByMode = {};

    const providerStatus = getNdviProviderStatus();
    console.log('[NDVI_PACKAGE_BACKEND_START]', {
      farmId,
      plotId,
      sceneId,
      imageDate,
      polygonValid: Boolean(polygon && polygon.type === 'Polygon'),
      modes: uniqueModes,
      force,
      provider: {
        ndviProvider: providerStatus.ndvi_provider,
        packageProvider: providerStatus.package_provider,
        geePackagePreferred: providerStatus.gee_package_preferred,
        geeReady: this._geeReady({ packageMode: true }),
      },
    });
    console.log('[Package] generate-package request', {
      field: plotId,
      scene: sceneId,
      resolution: 'preview',
      expectedBands: ['B02', 'B04', 'B05', 'B08', 'B8A', 'B11', 'SCL'],
      modes: uniqueModes,
    });

    this._requireScope({ farmId, plotId });
    if (!polygon || polygon.type !== 'Polygon') {
      throw this._error('Talhão sem polígono válido', 'plot_polygon_missing', 400);
    }
    const dbReady = await this._tryEnsureSchema('generateLayerPackage');
    const normalizedImageDate = normalizeImageDate(imageDate);
    const effectiveImageDate = resolveSceneAcquisitionDate({ sceneId, imageDate });
    if (effectiveImageDate && normalizedImageDate && effectiveImageDate !== normalizedImageDate) {
      console.warn('[NDVI_PACKAGE_DATE_MISMATCH]', {
        sceneId,
        requestImageDate: normalizedImageDate,
        effectiveImageDate,
      });
    }
    const polygonHash = hashPolygonForPackage(polygon);
    const packageCacheKey = buildScenePackageKey({
      farmId,
      plotId,
      sceneId,
      acquisitionDate: effectiveImageDate || normalizedImageDate,
      polygonHash,
      resolutionKind: 'preview',
    });
    console.log('[NDVI] CACHE_PACKAGE_LOOKUP', {
      key: packageCacheKey,
      sceneId,
      plotId,
      modes: uniqueModes,
    });
    const cachedPackage = await this._readCachedPackageLayers({
      dbReady,
      farmId,
      plotId,
      imageDate: effectiveImageDate || normalizedImageDate || imageDate,
      sceneId,
      maxCloud,
      polygon,
      modes: uniqueModes,
    });
    Object.assign(layersByMode, cachedPackage.layersByMode);
    Object.assign(statusesByMode, cachedPackage.statusesByMode);
    const pendingModes = uniqueModes.filter((mode) => !layersByMode[mode]);
    if (pendingModes.length === 0) {
      console.log('[NDVI] CACHE_PACKAGE_HIT', {
        key: packageCacheKey,
        sceneId,
        modes: uniqueModes,
        elapsedMs: Date.now() - startedAt,
      });
      return {
        scene_id: sceneId,
        packageCacheKey,
        packageStatus: 'ready',
        package_version: 'scene_band_package_v1',
        resolution_kind: 'preview',
        generatedAt: new Date().toISOString(),
        provider: 'render_cache',
        modes: uniqueModes,
        layersByMode,
        statusesByMode,
        elapsedMs: Date.now() - startedAt,
      };
    }
    console.log('[NDVI] CACHE_PACKAGE_MISS', {
      key: packageCacheKey,
      sceneId,
      readyModes: Object.keys(layersByMode),
      pendingModes,
    });
    if (this._geeReady({ packageMode: true }) && this.geeClient?.generateLayerPackage) {
      try {
        console.log('[NDVI_PACKAGE_BANDS]', {
          bandsRequested: ['B02', 'B04', 'B05', 'B08', 'B8A', 'B11', 'SCL'],
          bandsAvailable: 'gee_dynamic',
          bandsMissing: [],
          productLevel: 'L2A',
          tileId: sceneId || null,
        });
        console.log('[Package] using single-pass GEE package renderer', {
          field: plotId,
          scene: sceneId,
          modes: pendingModes,
        });
        const packageResult = await this.geeClient.generateLayerPackage({
          sceneId,
          polygon,
          imageDate: effectiveImageDate || normalizedImageDate || imageDate,
          startDate,
          endDate,
          maxCloud,
          farmId,
          plotId,
          modes: pendingModes,
        });
        for (const mode of pendingModes) {
          const modeStartedAt = Date.now();
          const assets = packageResult.layersByMode?.[mode];
          if (!assets) {
            statusesByMode[mode] = packageResult.statusesByMode?.[mode] || {
              status: 'unavailable',
              code: 'layer_not_returned',
              message: 'Camada não retornada pelo pacote GEE.',
              elapsedMs: 0,
            };
            continue;
          }
          try {
            const stats = NdviStatsService.buildStatsForAssets(assets);
            const hasRaster = this._hasRenderableAssets(assets);
            const statsValid =
              isValidNdviStats(stats) || hasCoreRenderableNdviStats(stats);
            if (!hasRaster || !statsValid) {
              throw this._error(
                'NDVI não foi calculado com estatísticas válidas.',
                'ndvi_not_computed',
                422,
                { mode, previewGenerated: hasRaster, statsComputed: statsValid },
              );
            }
            const targetSceneId = assets.scene_id || sceneId;
            const targetDate =
              normalizeImageDate(assets.image_date) ||
              effectiveImageDate ||
              normalizedImageDate;
            const targetCloud = assets.cloud_coverage ?? cloudCoverage;
            const mapped = await this._persistGeneratedLayer({
              dbReady,
              farmId,
              plotId,
              campaignId,
              targetSceneId,
              targetDate,
              targetCloud,
              assets,
              stats,
              layerStatus: 'generated',
              polygon,
              requestedVisualMode: mode,
              meta: {
                plotId,
                farmId,
                campaignId,
                sceneId: targetSceneId,
                imageDate: targetDate,
              },
              stage: 'persist_package',
            });
            layersByMode[mode] = mapped;
            statusesByMode[mode] = {
              status: 'ready',
              elapsedMs: Date.now() - modeStartedAt,
              preview: Boolean(mapped?.preview_url || mapped?.previewUrl),
              sourceBands: sourceBandsForMode(mode),
            };
            console.log('[NDVI_PACKAGE_MODE_READY]', {
              mode,
              overlayUrl: mapped?.preview_url || mapped?.previewUrl || null,
              statsReady: true,
              elapsedMs: statusesByMode[mode].elapsedMs,
            });
            console.log(`[NDVI_LAYER] READY mode=${mode}`, statusesByMode[mode]);
            console.log(`[LayerBatch] ${mode} persisted from single GEE package`, statusesByMode[mode]);
          } catch (error) {
            statusesByMode[mode] = {
              ...normalizePackageModeError(mode, error),
              elapsedMs: Date.now() - modeStartedAt,
            };
            const statusLabel = statusesByMode[mode].status === 'unavailable'
              ? 'NDVI_PACKAGE_MODE_UNAVAILABLE'
              : 'NDVI_PACKAGE_MODE_FAILED';
            console.warn(`[${statusLabel}]`, {
              mode,
              missingBands: statusesByMode[mode].missingBands || [],
              reason: statusesByMode[mode].code,
              message: statusesByMode[mode].message,
            });
            console.warn(`[NDVI_LAYER] ${statusesByMode[mode].status === 'unavailable' ? 'UNAVAILABLE' : 'FAILED'} mode=${mode}`, statusesByMode[mode]);
            console.warn(`[LayerBatch] ${mode} persist failed from single GEE package`, statusesByMode[mode]);
          }
        }
        console.log('[Package] ready', {
          field: plotId,
          scene: packageResult.scene_id || sceneId,
          provider: 'google_earth_engine',
          readyModes: Object.keys(layersByMode),
          elapsedMs: Date.now() - startedAt,
        });
        const packageStatus = resolvePackageStatus(layersByMode, statusesByMode);
        console.log('[NDVI_PACKAGE_DONE]', {
          packageStatus,
          readyModes: Object.keys(layersByMode),
          unavailableModes: Object.entries(statusesByMode)
            .filter(([, status]) => status?.status === 'unavailable')
            .map(([mode]) => mode),
          failedModes: Object.entries(statusesByMode)
            .filter(([, status]) => status?.status === 'failed')
            .map(([mode]) => mode),
          packageCacheKey: packageResult.packageCacheKey || packageCacheKey,
          elapsedMs: Date.now() - startedAt,
          provider: 'google_earth_engine',
        });
        if (Object.keys(layersByMode).length > 0 || packageStatus === 'unavailable') {
          return {
            scene_id: packageResult.scene_id || sceneId,
            packageCacheKey: packageResult.packageCacheKey || packageCacheKey,
            packageStatus,
            package_version: packageResult.package_version || 'scene_band_package_v1',
            resolution_kind: packageResult.resolution_kind || 'preview',
            generatedAt: new Date().toISOString(),
            provider: 'google_earth_engine',
            modes: uniqueModes,
            layersByMode,
            statusesByMode,
            elapsedMs: Date.now() - startedAt,
          };
        }
        console.warn('[Package] GEE package returned no ready layer; falling back', {
          field: plotId,
          scene: sceneId,
          statusesByMode,
        });
      } catch (error) {
        console.warn('[Package] single-pass GEE package failed; falling back to per-mode orchestration', {
          code: error?.code,
          message: error?.message || String(error),
        });
      }
    }

    if (this.processClient?.generateLayerPackage) {
      try {
        console.log('[Package] using Copernicus internal-grid package renderer', {
          field: plotId,
          scene: sceneId,
          modes: pendingModes,
        });
        const packageResult = await this.processClient.generateLayerPackage({
          sceneId,
          polygon,
          imageDate: effectiveImageDate || normalizedImageDate || imageDate,
          farmId,
          plotId,
          modes: pendingModes,
        });
        for (const mode of pendingModes) {
          const modeStartedAt = Date.now();
          const assets = packageResult.layersByMode?.[mode];
          if (!assets) {
            statusesByMode[mode] = packageResult.statusesByMode?.[mode] || {
              status: 'unavailable',
              code: 'layer_not_returned',
              message: 'Camada não retornada pelo pacote Copernicus.',
              elapsedMs: 0,
            };
            continue;
          }
          try {
            const stats = NdviStatsService.buildStatsForAssets(assets);
            const hasRaster = this._hasRenderableAssets(assets);
            const statsValid =
              isValidNdviStats(stats) || hasCoreRenderableNdviStats(stats);
            if (!hasRaster || !statsValid) {
              throw this._error(
                'Camada do pacote Copernicus sem raster ou estatísticas válidas.',
                'package_layer_not_computed',
                422,
                { mode, previewGenerated: hasRaster, statsComputed: statsValid },
              );
            }
            const targetSceneId = assets.scene_id || sceneId;
            const targetDate =
              normalizeImageDate(assets.image_date) ||
              effectiveImageDate ||
              normalizedImageDate;
            const targetCloud = assets.cloud_coverage ?? cloudCoverage;
            const mapped = await this._persistGeneratedLayer({
              dbReady,
              farmId,
              plotId,
              campaignId,
              targetSceneId,
              targetDate,
              targetCloud,
              assets,
              stats,
              layerStatus: 'generated',
              polygon,
              requestedVisualMode: mode,
              meta: {
                plotId,
                farmId,
                campaignId,
                sceneId: targetSceneId,
                imageDate: targetDate,
              },
              stage: 'persist_copernicus_package',
            });
            layersByMode[mode] = mapped;
            statusesByMode[mode] = {
              status: 'ready',
              elapsedMs: Date.now() - modeStartedAt,
              preview: Boolean(mapped?.preview_url || mapped?.previewUrl),
              source: 'copernicus_internal_grid_package',
              sourceBands: sourceBandsForMode(mode),
            };
            console.log(`[NDVI_LAYER] READY mode=${mode}`, statusesByMode[mode]);
          } catch (error) {
            statusesByMode[mode] = {
              ...normalizePackageModeError(mode, error),
              elapsedMs: Date.now() - modeStartedAt,
            };
            console.warn(`[NDVI_LAYER] ${statusesByMode[mode].status === 'unavailable' ? 'UNAVAILABLE' : 'FAILED'} mode=${mode}`, statusesByMode[mode]);
          }
        }
        const packageStatus = resolvePackageStatus(layersByMode, statusesByMode);
        if (Object.keys(layersByMode).length > 0 || packageStatus !== 'failed') {
          return {
            scene_id: packageResult.scene_id || sceneId,
            packageCacheKey: packageResult.packageCacheKey || packageCacheKey,
            packageStatus,
            package_version: packageResult.package_version || 'scene_band_package_v1',
            resolution_kind: packageResult.resolution_kind || 'preview',
            generatedAt: packageResult.generatedAt || new Date().toISOString(),
            provider: packageResult.provider || 'copernicus_dataspace',
            modes: uniqueModes,
            layersByMode,
            statusesByMode,
            elapsedMs: Date.now() - startedAt,
          };
        }
        console.warn('[Package] Copernicus package renderer returned no ready layers; falling back', {
          field: plotId,
          scene: sceneId,
          statusesByMode,
        });
      } catch (error) {
        console.warn('[Package] Copernicus package renderer failed; falling back to per-mode orchestration', {
          code: error?.code,
          message: error?.message || String(error),
        });
      }
    }

    for (const mode of pendingModes) {
      const modeStartedAt = Date.now();
      try {
        console.log(`[LayerBatch] generating ${mode} from package request`);
        const layer = await this.generateLayer({
          farmId,
          plotId,
          campaignId,
          sceneId,
          polygon,
          imageDate: effectiveImageDate || normalizedImageDate || imageDate,
          cloudCoverage,
          startDate,
          endDate,
          maxCloud,
          colormapMode,
          visualMode: mode,
          force,
        });
        layersByMode[mode] = layer;
        statusesByMode[mode] = {
          status: 'ready',
          elapsedMs: Date.now() - modeStartedAt,
          preview: Boolean(layer?.preview_url || layer?.previewUrl),
          sourceBands: sourceBandsForMode(mode),
        };
        console.log(`[NDVI_LAYER] READY mode=${mode}`, statusesByMode[mode]);
        console.log(`[LayerBatch] ${mode} ready preview`, statusesByMode[mode]);
      } catch (error) {
        statusesByMode[mode] = {
          ...normalizePackageModeError(mode, error),
          elapsedMs: Date.now() - modeStartedAt,
        };
        console.warn(`[NDVI_LAYER] ${statusesByMode[mode].status === 'unavailable' ? 'UNAVAILABLE' : 'FAILED'} mode=${mode}`, statusesByMode[mode]);
        console.warn('[NDVI_PACKAGE_MODE_SKIP]', {
          mode,
          code: statusesByMode[mode].code,
          message: statusesByMode[mode].message,
        });
        console.warn(`[LayerBatch] ${mode} unavailable/failed`, statusesByMode[mode]);
      }
    }

    const packageStatus = resolvePackageStatus(layersByMode, statusesByMode);
    console.log('[NDVI_PACKAGE_DONE]', {
      packageStatus,
      readyModes: Object.keys(layersByMode),
      unavailableModes: Object.entries(statusesByMode)
        .filter(([, status]) => status?.status === 'unavailable')
        .map(([mode]) => mode),
      failedModes: Object.entries(statusesByMode)
        .filter(([, status]) => status?.status === 'failed')
        .map(([mode]) => mode),
      packageCacheKey,
      elapsedMs: Date.now() - startedAt,
      provider: 'mixed_or_copernicus',
    });
    console.log('[NDVI_PACKAGE_GENERATE_DONE]', {
      farmId,
      plotId,
      sceneId,
      readyModes: Object.keys(layersByMode),
      elapsedMs: Date.now() - startedAt,
    });
    console.log('[Package] ready', {
      field: plotId,
      scene: sceneId,
      readyModes: Object.keys(layersByMode),
      elapsedMs: Date.now() - startedAt,
    });

    return {
      scene_id: sceneId,
      packageCacheKey,
      packageStatus,
      package_version: 'scene_band_package_v1',
      resolution_kind: 'preview',
      generatedAt: new Date().toISOString(),
      modes: uniqueModes,
      layersByMode,
      statusesByMode,
      elapsedMs: Date.now() - startedAt,
    };
  }

  async generateLayer({
    farmId,
    plotId,
    campaignId = null,
    sceneId,
    polygon,
    imageDate,
    cloudCoverage = null,
    startDate = null,
    endDate = null,
    maxCloud = null,
    colormapMode = 'ndvi_contrast',
    visualMode = null,
    force = false,
  }) {
    const requestedVisualMode = resolveRequestedVisualMode(
      visualMode || colormapMode || 'ndvi_contrast',
    );
    const meta = {
      plotId,
      farmId,
      campaignId,
      sceneId: sceneId || null,
      imageDate: resolveSceneAcquisitionDate({ sceneId, imageDate }),
    };
    let stage = 'init';

    try {
      logGenerateStart(meta);
      stage = 'provider_check';
      const providerStatus = getNdviProviderStatus();
      logGenerateStage(
        meta,
        stage,
        `providerRequested=${providerStatus.ndvi_provider} ` +
          `providerUsed=${providerStatus.cloud_api_uses} activeProvider=${providerStatus.active_provider} ` +
          `collection=sentinel-2-l2a bands=B04,B08`,
      );
      const geeAvailable = this._geeReady();

      if (process.env.NDVI_PROVIDER === 'gee' && !providerStatus.gee_configured) {
        throw this._error(
          'Google Earth Engine não está configurado no servidor (GEE_PROJECT_ID, GEE_CLIENT_EMAIL, GEE_PRIVATE_KEY).',
          'gee_not_configured',
          503,
          { provider: providerStatus },
        );
      }

      stage = 'validate';
      this._requireScope({ farmId, plotId });
      if (!polygon || polygon.type !== 'Polygon') {
        throw this._error('Talhão sem polígono válido', 'plot_polygon_missing', 400);
      }
      if (!Array.isArray(polygon.coordinates?.[0]) || polygon.coordinates[0].length < 4) {
        throw this._error(
          'Polígono inválido (anel insuficiente)',
          'invalid_polygon',
          400,
        );
      }

      const bboxStr = this.catalogClient.polygonToBbox(polygon)?.join(',') ?? '-';
      logGenerateStage(meta, stage, `bbox=${bboxStr} polygonRing=${polygon.coordinates[0].length}`);

      if (!geeAvailable) {
        assertCopernicusReady(this.authClient);
      }

      stage = 'ensure_schema';
      const dbReady = await this._tryEnsureSchema('generateLayer');
      logGenerateStage(meta, stage, `dbReady=${dbReady}`);

      let targetSceneId = sceneId ? String(sceneId).trim() : null;
      let targetDate = meta.imageDate;
      let targetCloud = cloudCoverage;
      const requestImageDate = normalizeImageDate(imageDate);
      if (targetDate && requestImageDate && targetDate !== requestImageDate) {
        console.warn('[NDVI_GENERATE_DATE_MISMATCH]', {
          sceneId: targetSceneId,
          requestImageDate,
          effectiveImageDate: targetDate,
          visualMode: requestedVisualMode,
        });
      }

      if (!targetSceneId) {
        stage = 'search_fallback';
        logGenerateStage(meta, stage);
        const scenes = await this.catalogClient.searchSentinelScenes({
          polygon,
          startDate: startDate || imageDate,
          endDate: endDate || imageDate,
          maxCloud: maxCloud ?? 20,
        });
        if (!scenes.length) {
          throw this._error(
            'Nenhuma imagem adequada foi encontrada para o período selecionado',
            'empty_scenes',
            404,
          );
        }
        const best = scenes[0];
        targetSceneId = String(best.scene_id || best.id);
        targetDate = normalizeImageDate(best.image_date) || targetDate;
        targetCloud = best.cloud_coverage ?? targetCloud;
        meta.sceneId = targetSceneId;
        meta.imageDate = targetDate;
      }

      if (!targetDate) {
        throw this._error('image_date é obrigatório', 'invalid_image_date', 400);
      }

      stage = 'visual_mode_gate';
      let persistedRaster = null;
      if (requestedVisualMode !== 'ndvi_contrast' && !geeAvailable) {
        try {
          persistedRaster = await loadInternalGrid({
            plotId,
            sceneId: targetSceneId,
            schemaVersion: RASTER_SCHEMA_NUM,
          });
        } catch (_) {
          persistedRaster = null;
        }
        // Unknown modes must fail early. Known Sentinel/Copernicus modes can be
        // generated remotely even when no internal raster exists yet.
        if (!persistedRaster) {
          assertVisualModeSupported({
            visualMode: requestedVisualMode,
            raster: { bands: { ndvi: [1], ndre: [1], savi: [1], bsi: [1], ndmi: [1] } },
            geeAvailable,
          });
          logGenerateStage(meta, stage, 'remote_copernicus_generation=allowed');
        } else {
          assertVisualModeSupported({
            visualMode: requestedVisualMode,
            raster: persistedRaster,
            geeAvailable,
          });
        }
      }

      stage = 'cache_lookup';
      logGenerateStage(
        meta,
        stage,
        `sceneId=${targetSceneId} dbReady=${dbReady} force=${force}`,
      );
      let cached = null;
      if (!force && dbReady) {
        try {
          cached = await this.repository.findRecentCache({
            farmId,
            plotId,
            imageDate: targetDate,
            sceneId: targetSceneId,
            maxCloud,
            visualMode: requestedVisualMode,
          });
        } catch (cacheError) {
          console.warn(
            `⚠️ [NDVI] cache lookup ignorado plotId=${plotId}: ${cacheError.message}`,
          );
        }
      } else if (force) {
        console.log('[NDVI_FORCE_CACHE_CHECK]', {
          force,
          cacheHit: false,
          cachedVisualMode: null,
          cachedHasContrast: false,
          requestedVisualMode,
        });
      }

      if (cached) {
        if (!isValidNdviLayerRow(cached)) {
          console.warn(
            `⚠️ [NDVI] cache ignorado plotId=${plotId} sceneId=${targetSceneId} ` +
              `imageDate=${targetDate} — stats inválidas ou NDVI zerado`,
          );
          if (dbReady && cached.id) {
            try {
              await this.repository.markLayerFailed(cached.id);
            } catch (markErr) {
              console.warn(
                `⚠️ [NDVI] markLayerFailed ignorado id=${cached.id}: ${markErr.message}`,
              );
            }
          }
          cached = null;
        }
      }

      if (cached) {
        let mapped = NdviResponseMapper.mapLayer(cached);
        const contrastOk = layerMeetsContrastContract(mapped, requestedVisualMode, {
          requestBounds: this._boundsFromPolygon(polygon),
        });
        console.log('[NDVI_FORCE_CACHE_CHECK]', {
          force,
          cacheHit: true,
          cachedVisualMode: mapped?.visual_mode ?? null,
          cachedHasContrast: contrastOk,
          requestedVisualMode,
        });
        if (contrastOk) {
          mapped = this._mergeMappedLayerFromAssets(mapped, null, {
            polygon,
            requestedVisualMode,
          });
          this._assertReadyLayerOrThrow(mapped, meta);
          this._assertContrastContractOrThrow(mapped, meta, {
            requestedVisualMode,
            polygon,
          });
          logGenerateOk(meta, mapped, { cacheHit: true });
          return mapped;
        }
        console.log(
          '[NDVI_DEBUG_CACHE] Cache rejected: mode mismatch or missing contrast/bounds.',
        );
        cached = null;
      }

      stage = 'raster_reuse';
      try {
        // Copernicus-first: GEE fica dormente por padrão. Quando não há opt-in
        // explícito, reutilizamos raster Copernicus persistido para modos
        // avançados sem chamar Earth Engine.
        const reused = geeAvailable
          ? null
          : await this.processClient.tryGenerateFromPersistedRaster?.({
          sceneId: targetSceneId,
          polygon,
          imageDate: targetDate,
          farmId,
          plotId,
          visualMode: requestedVisualMode,
          colormapMode,
        });
        if (reused?.preview_url && reused?.raster_available) {
            logGenerateStage(meta, stage, 'hit=persisted_raster');
            const stats = NdviStatsService.buildStatsForAssets(reused);
            const plotBounds = this._boundsFromPolygon(polygon);
            const layerId = randomUUID();
            let saved = null;
            if (dbReady) {
              saved = await this.repository.upsertLayer({
                id: layerId,
                scene_id: String(targetSceneId),
                farm_id: farmId,
                plot_id: plotId,
                campaign_id: campaignId,
                source: reused.source || 'sentinel-2-l2a',
                image_date: targetDate,
                cloud_coverage: targetCloud,
                resolution_m: 10,
                ...stats,
                agronomic_stats: {
                  ...stats,
                  schema_version: 'ndvi_v3',
                  ndvi_schema_version: 3,
                  contrast: reused.contrast ?? stats.contrast,
                  visual_mode: reused.visual_mode ?? requestedVisualMode,
                  bounds: plotBounds,
                  renderer_version:
                    reused.rendererVersion ?? reused.renderer_version ?? reused.contrast?.rendererVersion ?? null,
                  raster_available: true,
                  raster_storage_key: reused.raster_storage_key,
                  raster_storage_provider: reused.raster_storage_provider,
                  raster_schema_version: reused.raster_schema_version,
                  zones: reused.zones ?? stats.zones ?? [],
                  spatial_metrics: reused.spatial_metrics ?? stats.spatial_metrics,
                  rendering: reused.rendering ?? stats.rendering,
                  diagnosis: reused.diagnosis ?? stats.diagnosis ?? null,
                  legend: reused.legend ?? stats.legend ?? null,
                  sourceContext: reused.sourceContext ?? stats.sourceContext ?? null,
                  source_context: reused.source_context ?? stats.source_context ?? null,
                  cacheHit: true,
                  cacheTag: reused.cacheTag ?? reused.cache_tag ?? null,
                  generatedAt: reused.generatedAt ?? reused.generated_at ?? null,
                },
                schema_version: 'ndvi_v3',
                ndvi_schema_version: 3,
                visual_mode: reused.visual_mode ?? requestedVisualMode,
                preview_url: reused.preview_url,
                raster_available: true,
                status: 'generated',
              });
            }
            const mapped = NdviResponseMapper.mapLayer(
              saved || this._buildEphemeralLayerRow({
                layerId,
                farmId,
                plotId,
                campaignId,
                targetSceneId,
                targetDate,
                targetCloud,
                layerStatus: 'generated',
                stats,
                assets: reused,
                bounds: plotBounds,
                requestedVisualMode,
              }),
            );
            this._assertReadyLayerOrThrow(mapped, meta);
            this._assertContrastContractOrThrow(mapped, meta, {
              requestedVisualMode,
              polygon,
            });
            logGenerateOk(meta, mapped, { cacheHit: false, rasterReuse: true });
            return mapped;
          }
      } catch (reuseErr) {
        console.warn(`⚠️ [NDVI] raster reuse ignorado: ${reuseErr.message}`);
      }

      stage = 'process';
      logGenerateStage(meta, stage, `provider=${geeAvailable ? 'gee' : 'copernicus'}`);
      const processParams = {
        sceneId: targetSceneId,
        polygon,
        imageDate: targetDate,
        startDate,
        endDate,
        maxCloud,
        farmId,
        plotId,
        campaignId,
        colormapMode,
        visualMode: requestedVisualMode,
        forceRemote: force,
      };

      let assets;
      let assetProvider = 'copernicus_dataspace';
      if (geeAvailable) {
        try {
          assets = await this.geeClient.generateLayer(processParams);
          // O manager/cliente devolve { provider, layer } ou layer direto.
          if (assets?.layer) {
            assetProvider = assets.provider || 'google_earth_engine';
            assets = assets.layer;
          } else {
            assetProvider = assets?.provider_used || assets?.provider || 'google_earth_engine';
          }
        } catch (geeError) {
          // Modos avançados não fazem fallback Copernicus → propaga 422.
          if (requestedVisualMode !== 'ndvi_contrast') {
            throw this._error(
              geeError?.message ||
                `Modo "${requestedVisualMode}" exige Google Earth Engine.`,
              geeError?.code || 'unsupported_visual_mode',
              geeError?.status || 422,
              { requestedVisualMode, provider: 'google_earth_engine' },
            );
          }
          console.warn(
            `⚠️ [NDVI] GEE falhou (ndvi_contrast), fallback Copernicus: ${geeError?.message || geeError}`,
          );
          assets = null;
        }
      }

      if (!assets) {
        try {
          assets = await this.processClient.generateNdviLayer(processParams);
          assetProvider = 'copernicus_dataspace';
        } catch (processError) {
          const alternative = await this._tryGenerateAlternativeSceneLayer({
            farmId,
            plotId,
            polygon,
            failedSceneId: targetSceneId,
            targetDate,
            startDate,
            endDate,
            maxCloud,
            requestedVisualMode,
            colormapMode,
            originalError: processError,
          });
          if (alternative) {
            assets = alternative.assets;
            targetSceneId = alternative.sceneId;
            targetDate = alternative.imageDate;
            targetCloud = alternative.cloudCoverage ?? targetCloud;
            meta.sceneId = targetSceneId;
            meta.imageDate = targetDate;
            assetProvider = 'copernicus_dataspace_alternative_scene';
            logGenerateStage(
              meta,
              'process_fallback',
              `alternativeSceneId=${targetSceneId} alternativeDate=${targetDate}`,
            );
          } else {
            throw this._providerError(
              processError,
              'Não foi possível gerar NDVI no provedor de imagens',
            );
          }
        }
      }
      logGenerateStage(meta, 'provider_used', assetProvider);

      const hasRaster = this._hasRenderableAssets(assets);
      const stats = NdviStatsService.buildStatsForAssets(assets);
      const rawStatsProbe = {
        ndvi_mean: assets?.ndvi_mean ?? assets?.ndviMean,
        ndvi_min: assets?.ndvi_min ?? assets?.ndviMin,
        ndvi_max: assets?.ndvi_max ?? assets?.ndviMax,
        very_low_percent: assets?.very_low_percent ?? assets?.veryLowPercent,
        low_percent: assets?.low_percent ?? assets?.lowPercent,
        medium_percent: assets?.medium_percent ?? assets?.mediumPercent,
        high_percent: assets?.high_percent ?? assets?.highPercent,
      };
      const statsValid = isValidNdviStats(stats) || hasCoreRenderableNdviStats(stats);
      const layerStatus =
        hasRaster && statsValid ? 'generated' : 'metadata_only';

      if (!hasRaster || !statsValid) {
        const alternative = await this._tryGenerateAlternativeSceneLayer({
          farmId,
          plotId,
          polygon,
          failedSceneId: targetSceneId,
          targetDate,
          startDate,
          endDate,
          maxCloud,
          requestedVisualMode,
          colormapMode,
          originalError: new Error('Camada sem preview ou estatísticas válidas.'),
        });
        if (alternative) {
          assets = alternative.assets;
          targetSceneId = alternative.sceneId;
          targetDate = alternative.imageDate;
          targetCloud = alternative.cloudCoverage ?? targetCloud;
          meta.sceneId = targetSceneId;
          meta.imageDate = targetDate;
          assetProvider = 'copernicus_dataspace_alternative_scene';
          logGenerateStage(
            meta,
            'stats_fallback',
            `alternativeSceneId=${targetSceneId} alternativeDate=${targetDate}`,
          );
          const fallbackStats = NdviStatsService.buildStatsForAssets(assets);
          const fallbackHasRaster = this._hasRenderableAssets(assets);
          const fallbackStatsValid =
            isValidNdviStats(fallbackStats) ||
            hasCoreRenderableNdviStats(fallbackStats);
          if (fallbackHasRaster && fallbackStatsValid) {
            stage = 'persist';
            logGenerateStage(meta, stage, 'status=generated dbReady=' + dbReady);
            const mapped = await this._persistGeneratedLayer({
              dbReady,
              farmId,
              plotId,
              campaignId,
              targetSceneId,
              targetDate,
              targetCloud,
              assets,
              stats: fallbackStats,
              layerStatus: 'generated',
              polygon,
              requestedVisualMode,
              meta,
              stage,
            });
            logGenerateOk(meta, mapped, {
              rasterGenerated: 'yes',
              statsComputed: 'yes',
              colormapMode: assets?.colormap_mode ?? '-',
              fallbackScene: 'yes',
            });
            return mapped;
          }
        }
        const reason =
          invalidNdviStatsReason(rawStatsProbe) ||
          invalidNdviStatsReason(stats) ||
          (!hasRaster ? 'no_preview' : 'invalid_stats');
        console.warn(
          `⚠️ [NDVI][generate] ndvi_not_computed plotId=${plotId} sceneId=${targetSceneId} ` +
            `reason=${reason} preview=${hasRaster ? 'yes' : 'no'} ` +
            `mean=${stats?.ndvi_mean ?? '-'} min=${stats?.ndvi_min ?? '-'} max=${stats?.ndvi_max ?? '-'} ` +
            `veryLow=${stats?.very_low_percent ?? '-'} low=${stats?.low_percent ?? '-'} ` +
            `medium=${stats?.medium_percent ?? '-'} high=${stats?.high_percent ?? '-'}`,
        );
        throw this._error(
          'NDVI não foi calculado com estatísticas válidas.',
          'ndvi_not_computed',
          422,
          {
            previewGenerated: hasRaster,
            statsComputed: false,
            reason,
          },
        );
      }

      stage = 'persist';
      logGenerateStage(meta, stage, `status=${layerStatus} dbReady=${dbReady}`);
      const mapped = await this._persistGeneratedLayer({
        dbReady,
        farmId,
        plotId,
        campaignId,
        targetSceneId,
        targetDate,
        targetCloud,
        assets,
        stats,
        layerStatus,
        polygon,
        requestedVisualMode,
        meta,
        stage,
      });
      logGenerateOk(meta, mapped, {
        rasterGenerated: hasRaster ? 'yes' : 'no',
        statsComputed: stats?.ndvi_mean != null ? 'yes' : 'no',
        colormapMode: assets?.colormap_mode ?? '-',
      });
      return mapped;
    } catch (error) {
      logGenerateFail(meta, stage, error);
      if (error?.code && error?.status) throw error;
      throw this._error(
        'Falha ao gerar camada NDVI',
        'generate_failed',
        500,
        { stage, cause: error?.message },
      );
    }
  }

  async _tryGenerateAlternativeSceneLayer({
    farmId,
    plotId,
    polygon,
    failedSceneId,
    targetDate,
    startDate,
    endDate,
    maxCloud,
    requestedVisualMode,
    colormapMode,
    originalError,
  }) {
    if (!this.catalogClient?.searchSentinelScenes || !this.processClient?.generateNdviLayer) {
      return null;
    }
    if (!polygon || polygon.type !== 'Polygon') return null;

    const centerDate = normalizeImageDate(targetDate);
    const fromText = normalizeImageDate(startDate) || centerDate;
    const toText = normalizeImageDate(endDate) || centerDate;
    const from = fromText ? new Date(`${fromText}T00:00:00Z`) : null;
    const to = toText ? new Date(`${toText}T00:00:00Z`) : null;
    const fallbackStart = from
      ? new Date(from.getTime() - 3 * 24 * 60 * 60 * 1000)
      : null;
    const fallbackEnd = to
      ? new Date(to.getTime() + 3 * 24 * 60 * 60 * 1000)
      : null;
    const start = fallbackStart?.toISOString().slice(0, 10) || centerDate;
    const end = fallbackEnd?.toISOString().slice(0, 10) || centerDate;
    if (!start || !end) return null;

    console.warn('[NDVI_PROVIDER_FALLBACK_SCENE_SEARCH]', {
      plotId,
      failedSceneId,
      targetDate,
      requestedVisualMode,
      originalError: originalError?.message || String(originalError || ''),
      start,
      end,
    });

    let scenes = [];
    try {
      scenes = await this.catalogClient.searchSentinelScenes({
        polygon,
        startDate: start,
        endDate: end,
        maxCloud: maxCloud ?? 20,
      });
    } catch (searchError) {
      console.warn('[NDVI_PROVIDER_FALLBACK_SCENE_SEARCH_FAILED]', {
        plotId,
        failedSceneId,
        message: searchError?.message || String(searchError),
      });
      return null;
    }

    const failedKey = String(failedSceneId || '').trim();
    const candidates = scenes
      .map((scene) => ({
        sceneId: String(scene.scene_id || scene.id || '').trim(),
        imageDate: normalizeImageDate(scene.image_date || scene.date || scene.datetime),
        cloudCoverage: scene.cloud_coverage ?? scene.cloudCoverage ?? null,
      }))
      .filter((scene) => scene.sceneId && scene.sceneId !== failedKey && scene.imageDate)
      .sort((a, b) => Number(a.cloudCoverage ?? 100) - Number(b.cloudCoverage ?? 100))
      .slice(0, 3);

    for (const candidate of candidates) {
      try {
        console.warn('[NDVI_PROVIDER_FALLBACK_SCENE_TRY]', {
          plotId,
          failedSceneId,
          candidateSceneId: candidate.sceneId,
          candidateDate: candidate.imageDate,
          candidateCloud: candidate.cloudCoverage,
        });
        const assets = await this.processClient.generateNdviLayer({
          sceneId: candidate.sceneId,
          polygon,
          imageDate: candidate.imageDate,
          farmId,
          plotId,
          colormapMode,
          visualMode: requestedVisualMode,
          forceRemote: true,
        });
        const stats = NdviStatsService.buildStatsForAssets(assets);
        const ok =
          this._hasRenderableAssets(assets) &&
          (isValidNdviStats(stats) || hasCoreRenderableNdviStats(stats));
        if (!ok) {
          console.warn('[NDVI_PROVIDER_FALLBACK_SCENE_REJECTED]', {
            plotId,
            candidateSceneId: candidate.sceneId,
            preview: this._hasRenderableAssets(assets),
            ndviMean: stats?.ndvi_mean ?? null,
          });
          continue;
        }
        return {
          assets,
          sceneId: candidate.sceneId,
          imageDate: candidate.imageDate,
          cloudCoverage: candidate.cloudCoverage,
        };
      } catch (candidateError) {
        console.warn('[NDVI_PROVIDER_FALLBACK_SCENE_FAILED]', {
          plotId,
          candidateSceneId: candidate.sceneId,
          message: candidateError?.message || String(candidateError),
        });
      }
    }

    return null;
  }

  async attachLayer({ campaignId, farmId, plotId, layerId, payload = {} }) {
    if (!campaignId) {
      throw this._error('campaign_id é obrigatório', 'campaign_required', 400);
    }
    this._requireScope({ farmId, plotId });
    const dbReady = await this._tryEnsureSchema('attachLayer');
    if (!dbReady) {
      throw this._error(
        'Serviço NDVI indisponível. Tente novamente em instantes.',
        'NDVI_SERVICE_UNAVAILABLE',
        503,
        { stage: 'attach', cause: 'database_unavailable' },
      );
    }

    const layerPayload = payload.layer || payload;
    const resolvedLayerId =
      layerId || layerPayload.layer_id || layerPayload.id || payload.layer_id;

    try {
      let layer = null;
      if (resolvedLayerId) {
        layer = await this.repository.getById(resolvedLayerId);
      }

      if (!layer) {
        layer = await this.repository.upsertLayer({
          id: resolvedLayerId,
          farm_id: farmId,
          plot_id: plotId,
          campaign_id: campaignId,
          source: layerPayload.source || payload.source || 'sentinel_2_l2a',
          image_date:
            layerPayload.image_date ||
            payload.image_date ||
            new Date().toISOString().slice(0, 10),
          cloud_coverage: layerPayload.cloud_coverage ?? payload.cloud_coverage,
          resolution_m: layerPayload.resolution_m ?? payload.resolution_m ?? 10,
          ndvi_mean: layerPayload.ndvi_mean ?? payload.ndvi_mean,
          ndvi_min: layerPayload.ndvi_min ?? payload.ndvi_min,
          ndvi_max: layerPayload.ndvi_max ?? payload.ndvi_max,
          very_low_percent: layerPayload.very_low_percent ?? payload.very_low_percent,
          low_percent: layerPayload.low_percent ?? payload.low_percent,
          medium_percent: layerPayload.medium_percent ?? payload.medium_percent,
          high_percent: layerPayload.high_percent ?? payload.high_percent,
          preview_url: layerPayload.preview_url ?? payload.preview_url,
          tile_url: layerPayload.tile_url ?? payload.tile_url,
          raster_url: layerPayload.raster_url ?? payload.raster_url,
          is_active: false,
        });
      }

      const activated = await this.repository.setActiveLayer({
        campaignId,
        layerId: layer.id,
        farmId,
        plotId,
      });

      if (!activated) {
        throw this._error('Não foi possível ativar camada NDVI', 'activate_failed', 500);
      }

      return NdviResponseMapper.mapLayer(activated);
    } catch (error) {
      if (error?.code && error?.status) throw error;
      const pgCode = error?.code;
      if (pgCode === '28P01' || pgCode === 'ECONNREFUSED' || pgCode === 'ENOTFOUND') {
        throw this._error(
          'Serviço NDVI indisponível. Tente novamente em instantes.',
          'NDVI_SERVICE_UNAVAILABLE',
          503,
          { stage: 'attach', pg_code: pgCode },
        );
      }
      throw error;
    }
  }

  async getActiveLayer({ campaignId, farmId, plotId }) {
    if (!campaignId) {
      throw this._error('campaign_id é obrigatório', 'campaign_required', 400);
    }
    this._requireScope({ farmId, plotId });
    await this.repository.ensureSchema();
    const layer = await this.repository.getActiveByCampaign({ campaignId, farmId, plotId });
    return layer ? NdviResponseMapper.mapLayer(layer) : null;
  }

  async refreshCampaign({
    campaignId,
    farmId,
    plotId,
    polygon,
    startDate,
    endDate,
    maxCloud,
  }) {
    const active = await this.getActiveLayer({ campaignId, farmId, plotId });
    const scenes = await this.searchScenes({
      farmId,
      plotId,
      campaignId,
      polygon,
      startDate,
      endDate,
      maxCloud,
    });

    return {
      active_layer_id: active?.layer_id || active?.id || null,
      scenes,
    };
  }

  getProviderStatus() {
    return getNdviProviderStatus();
  }

  /**
   * Diagnóstico do provider GEE para /gee-health.
   * Copernicus é o provider ativo; GEE só pode ser usado com opt-in explícito.
   */
  getGeeHealth() {
    const status = getNdviProviderStatus();
    const engineLoaded = this._geeReady();
    const effectiveProvider = engineLoaded ? 'google_earth_engine' : 'copernicus_dataspace';

    let readiness = 'disabled_by_policy';
    if (engineLoaded) {
      readiness = 'ready';
    } else if (status.gee_primary) {
      readiness = 'enabled_engine_missing';
    } else if (status.gee_usage_allowed && !status.gee_configured) {
      readiness = 'enabled_not_configured';
    }

    return {
      provider: effectiveProvider,
      gee_enabled: status.gee_enabled,
      gee_hidden: status.gee_hidden,
      gee_usage_allowed: status.gee_usage_allowed,
      gee_configured: status.gee_configured,
      gee_primary: status.gee_primary,
      gee_engine_loaded: engineLoaded,
      copernicus_fallback: !engineLoaded,
      copernicus_configured: status.copernicus_configured,
      storage_configured: status.storage_configured,
      readiness,
      advanced_modes_available: engineLoaded,
    };
  }

  _requireScope({ farmId, plotId }) {
    if (!farmId || String(farmId).trim() === '') {
      throw this._error('farm_id é obrigatório', 'farm_scope_required', 400);
    }
    if (!plotId || String(plotId).trim() === '') {
      throw this._error('plot_id é obrigatório', 'plot_scope_required', 400);
    }
  }

  _providerError(error, fallbackMessage) {
    if (error?.code && error?.status) {
      const err = new Error(error.message || fallbackMessage);
      err.code = 'NDVI_PROVIDER_ERROR';
      err.status =
        error.status === 504 ? 504 : error.status >= 500 ? 502 : error.status;
      err.details = {
        ...(error.details && typeof error.details === 'object' ? error.details : {}),
        provider_code: error.code,
        provider_message: error.message,
      };
      return err;
    }
    return this._error(fallbackMessage, 'NDVI_PROVIDER_ERROR', 502, {
      cause: error?.message,
    });
  }

  _error(message, code, status = 500, details = null) {
    const err = new Error(message);
    err.code = code;
    err.status = status;
    if (details && typeof details === 'object') {
      err.details = details;
    }
    return err;
  }
}

export default SoilSamplingNdviService;
