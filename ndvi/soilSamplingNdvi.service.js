import { randomUUID } from 'node:crypto';
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

class SoilSamplingNdviService {
  constructor({ repository, catalogClient, processClient, authClient, geeClient = null }) {
    this.repository = repository;
    this.catalogClient = catalogClient;
    this.processClient = processClient;
    this.authClient = authClient;
    this.geeClient = geeClient;
  }

  /** GEE pronto (engine injetado e implementado). */
  _geeReady() {
    return Boolean(this.geeClient?.isImplemented?.());
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
        `deduped=${scenes.length} elapsedMs=${Date.now() - started}`,
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
      imageDate: normalizeImageDate(imageDate),
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

      assertCopernicusReady(this.authClient);

      stage = 'ensure_schema';
      const dbReady = await this._tryEnsureSchema('generateLayer');
      logGenerateStage(meta, stage, `dbReady=${dbReady}`);

      let targetSceneId = sceneId ? String(sceneId).trim() : null;
      let targetDate = meta.imageDate;
      let targetCloud = cloudCoverage;

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
      const geeAvailable = this._geeReady();
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
        assertVisualModeSupported({
          visualMode: requestedVisualMode,
          raster: persistedRaster,
          geeAvailable,
        });
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
        // GEE-primary: quando GEE está disponível, geramos direto via GEE
        // (renderiza qualquer modo server-side) e ignoramos o reuse de raster
        // Copernicus persistido.
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
                  raster_available: true,
                  raster_storage_key: reused.raster_storage_key,
                  raster_storage_provider: reused.raster_storage_provider,
                  raster_schema_version: reused.raster_schema_version,
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
          throw this._providerError(
            processError,
            'Não foi possível gerar NDVI no provedor de imagens',
          );
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
      const statsValid = isValidNdviStats({
        ndvi_mean: stats.ndvi_mean,
        ndvi_min: stats.ndvi_min,
        ndvi_max: stats.ndvi_max,
        very_low_percent: stats.very_low_percent,
        low_percent: stats.low_percent,
        medium_percent: stats.medium_percent,
        high_percent: stats.high_percent,
      });
      const layerStatus =
        hasRaster && statsValid ? 'generated' : 'metadata_only';

      if (!hasRaster || !statsValid) {
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
              renderer_version: assets?.contrast?.rendererVersion ?? null,
              zones: assets.zones ?? stats.zones ?? [],
              spatial_metrics: assets.spatial_metrics ?? stats.spatial_metrics,
              rendering: assets.rendering ?? stats.rendering,
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

      stage = 'map_response';
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
   * Diagnóstico do provider GEE para o endpoint /gee-health.
   * `gee_engine_loaded` indica se o engine real foi injetado (pipeline portado
   * + @google/earthengine instalado). Sem ele, o cloud-api usa Copernicus.
   */
  getGeeHealth() {
    const status = getNdviProviderStatus();
    const engineLoaded = this._geeReady();
    const effectiveProvider = engineLoaded
      ? 'google_earth_engine'
      : 'copernicus_dataspace';

    let readiness = 'disabled';
    if (engineLoaded) {
      readiness = 'ready';
    } else if (status.gee_primary) {
      // Habilitado + configurado, mas engine ainda não carregado/portado.
      readiness = 'enabled_engine_missing';
    } else if (status.gee_enabled && !status.gee_configured) {
      readiness = 'enabled_not_configured';
    }

    return {
      provider: effectiveProvider,
      gee_enabled: status.gee_enabled,
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
