import {
  isValidNdviGenerateHttpPayload,
  readNdviGenerateStatsForDetails,
} from './ndviGenerateHttpValidity.js';
import {
  resolveRequestedVisualMode,
  validateNdviContrastHttpResponse,
} from './ndviContrastHttpValidity.js';
import { geeSmokeFailurePayload, runGeeSmokeTest } from './geeTest.js';

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function getLayerPayload(result) {
  return result?.layer || result?.data || result?.result || result;
}

function getContrast(layer) {
  const agronomicStats = parseMaybeJson(layer?.agronomic_stats_json);
  return (
    layer?.contrast ||
    layer?.stats?.contrast ||
    layer?.agronomicStats?.contrast ||
    agronomicStats?.contrast ||
    agronomicStats?.stats?.contrast ||
    null
  );
}

function normalizeSuccessLayer(layer) {
  const visualMode =
    layer?.visual_mode ??
    layer?.visualMode ??
    parseMaybeJson(layer?.agronomic_stats_json)?.visual_mode ??
    'ndvi_contrast';
  return {
    ...layer,
    status: 'ready',
    schema_version: 'ndvi_v3',
    schemaVersion: 'ndvi_v3',
    ndvi_schema_version: 3,
    ndviSchemaVersion: 3,
    visual_mode: visualMode,
    visualMode,
    is_legacy_schema: false,
    isLegacySchema: false,
    isLegacy: false,
  };
}

class SoilSamplingNdviController {
  constructor(service, { authClient } = {}) {
    this.service = service;
    this.authClient = authClient;

    this.getScenes = this.getScenes.bind(this);
    this.searchScenes = this.searchScenes.bind(this);
    this.generate = this.generate.bind(this);
    this.attach = this.attach.bind(this);
    this.getActive = this.getActive.bind(this);
    this.refresh = this.refresh.bind(this);
    this.testCopernicusToken = this.testCopernicusToken.bind(this);
    this.getStatus = this.getStatus.bind(this);
    this.getGeeHealth = this.getGeeHealth.bind(this);
    this.getGeeTest = this.getGeeTest.bind(this);
    this.listLayers = this.listLayers.bind(this);
  }

  async searchScenes(req, res) {
    try {
      const { plotId } = req.params;
      const {
        farm_id: farmId,
        campaign_id: campaignId,
        polygon,
        start_date: startDate,
        end_date: endDate,
        max_cloud: maxCloud,
      } = req.body;

      const scenes = await this.service.searchScenes({
        farmId,
        plotId,
        campaignId,
        polygon,
        startDate,
        endDate,
        maxCloud: maxCloud != null ? Number(maxCloud) : 20,
      });

      res.json({ success: true, scenes });
    } catch (error) {
      this._sendError(res, error);
    }
  }

  async listLayers(req, res) {
    try {
      const { plotId } = req.params;
      const { farm_id: farmId } = req.query;
      if (!farmId) {
        return this._sendError(
          res,
          Object.assign(new Error('farm_id é obrigatório na query'), {
            code: 'farm_scope_required',
            status: 400,
          }),
        );
      }

      const layers = await this.service.listPlotLayers({ farmId, plotId });
      res.json({ success: true, layers });
    } catch (error) {
      this._sendError(res, error);
    }
  }

  async getScenes(req, res) {
    try {
      const { plotId } = req.params;
      const { campaign_id: campaignId, start_date: startDate, end_date: endDate } =
        req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: 'Use POST /plots/:plotId/scenes/search com polygon no corpo',
          code: 'use_post_search',
        });
      }

      res.json({
        success: true,
        scenes: [],
        hint: 'Envie polygon via POST /plots/:plotId/scenes/search',
        campaign_id: campaignId || null,
        plot_id: plotId,
      });
    } catch (error) {
      this._sendError(res, error);
    }
  }

  async generate(req, res) {
    try {
      console.log('[NDVI_REAL_HANDLER_HIT]', {
        file: 'backend/fortsmart-cloud-api/ndvi/soilSamplingNdvi.controller.js',
        time: new Date().toISOString(),
        body: req.body,
      });
      const { plotId } = req.params;
      const {
        farm_id: farmId,
        campaign_id: campaignId,
        scene_id: sceneId,
        polygon,
        image_date: imageDate,
        cloud_coverage: cloudCoverage,
        start_date: startDate,
        end_date: endDate,
        max_cloud: maxCloud,
        colormap_mode: colormapMode,
        visual_mode: visualMode,
        visualMode: visualModeCamel,
      } = req.body;

      const requestedVisualMode = resolveRequestedVisualMode({
        visual_mode: visualMode,
        visualMode: visualModeCamel,
        colormap_mode: colormapMode,
      });
      const isForce =
        req.body.force === true || req.body.force_regenerate === true;

      console.log('[NDVI_BACKEND_REQUEST]', {
        visual_mode: visualMode,
        visualMode: visualModeCamel,
        requestedVisualMode,
        force: isForce,
      });

      console.log(
        `ℹ️ [NDVI][HTTP] POST generate plotId=${plotId} farmId=${farmId} ` +
          `campaignId=${campaignId || '-'} sceneId=${sceneId || '-'} ` +
          `imageDate=${imageDate || '-'} visualMode=${requestedVisualMode} force=${isForce}`,
      );

      if (!farmId || !plotId) {
        return this._sendError(
          res,
          Object.assign(new Error('farm_id e plot_id são obrigatórios'), {
            code: 'farm_scope_required',
            status: 400,
          }),
        );
      }

      const result = await this.service.generateLayer({
        farmId,
        plotId,
        campaignId,
        sceneId,
        polygon,
        imageDate,
        cloudCoverage,
        startDate,
        endDate,
        maxCloud: maxCloud != null ? Number(maxCloud) : null,
        colormapMode: colormapMode || 'auto',
        visualMode: requestedVisualMode,
        force: isForce,
      });

      let layer = getLayerPayload(result);

      if (!layer) {
        return this._sendError(
          res,
          Object.assign(new Error('Resposta NDVI sem camada'), {
            code: 'invalid_layer_response',
            status: 500,
          }),
        );
      }

      if (!isValidNdviGenerateHttpPayload(layer)) {
        const stats = readNdviGenerateStatsForDetails(layer);
        const previewGenerated = Boolean(
          (layer.preview_url && String(layer.preview_url).trim()) ||
            (layer.previewUrl && String(layer.previewUrl).trim()) ||
            (layer.tile_url && String(layer.tile_url).trim()) ||
            (layer.tileUrl && String(layer.tileUrl).trim()) ||
            (layer.raster_url && String(layer.raster_url).trim()) ||
            (layer.rasterUrl && String(layer.rasterUrl).trim()),
        );
        console.warn(
          `⚠️ [NDVI][HTTP] generate bloqueado 422 plotId=${plotId} ` +
            `reason=zero_or_invalid_stats preview=${previewGenerated ? 'yes' : 'no'} ` +
            `mean=${stats.ndviMean ?? '-'} min=${stats.ndviMin ?? '-'} max=${stats.ndviMax ?? '-'}`,
        );
        return res.status(422).json({
          success: false,
          code: 'ndvi_not_computed',
          message: 'NDVI não foi calculado com estatísticas válidas.',
          details: {
            previewGenerated,
            statsComputed: false,
            reason: 'zero_or_invalid_stats',
            ndviMean: stats.ndviMean,
            ndviMin: stats.ndviMin,
            ndviMax: stats.ndviMax,
          },
        });
      }

      // Gate absoluto: ndvi_contrast nunca pode retornar 201 legacy.
      const requestedVisualModeGate =
        req.body.visual_mode || req.body.visualMode || 'ndvi_contrast';
      const layerForGate = getLayerPayload(result);
      const resultVisualMode =
        layerForGate?.visual_mode ||
        layerForGate?.visualMode ||
        parseMaybeJson(layerForGate?.agronomic_stats_json)?.visual_mode ||
        parseMaybeJson(layerForGate?.agronomic_stats_json)?.visualMode ||
        null;
      const contrast = getContrast(layerForGate);

      const hasValidContrast =
        Boolean(contrast) &&
        contrast.p5 != null &&
        contrast.p50 != null &&
        contrast.p95 != null &&
        Number.isFinite(Number(contrast.p5)) &&
        Number.isFinite(Number(contrast.p50)) &&
        Number.isFinite(Number(contrast.p95));
      const hasValidPreview = Boolean(layerForGate?.preview_url || layerForGate?.previewUrl);
      const validForContrast =
        requestedVisualModeGate !== 'ndvi_contrast' ||
        (resultVisualMode === 'ndvi_contrast' && hasValidContrast && hasValidPreview);

      console.log('[NDVI_FINAL_GATE]', {
        requestedVisualMode: requestedVisualModeGate,
        resultVisualMode,
        hasValidContrast,
        p5: contrast?.p5,
        p50: contrast?.p50,
        p95: contrast?.p95,
        hasValidPreview,
        validForContrast,
      });

      if (!validForContrast) {
        return res.status(422).json({
          success: false,
          code: 'ndvi_contrast_not_computed',
          reason: 'backend_returned_legacy_layer',
          details: {
            requestedVisualMode: requestedVisualModeGate,
            resultVisualMode,
            hasValidContrast,
            p5: contrast?.p5,
            p50: contrast?.p50,
            p95: contrast?.p95,
            hasValidPreview,
          },
        });
      }

      // Guard anti-regressão: no modo contraste, se há amplitude real de NDVI
      // (p95-p5 >= 0.05) mas o preview ficou dominado por verde (>90%), o
      // renderizador não aplicou o stretch por percentil — bloqueia 422.
      if (
        requestedVisualModeGate === 'ndvi_contrast' &&
        hasValidContrast &&
        Number(contrast.p95) - Number(contrast.p5) >= 0.05
      ) {
        const buckets = contrast.colorBuckets || {};
        const greenDominance =
          Number(buckets.greenPercent ?? 0) +
          Number(buckets.darkGreenPercent ?? 0);
        if (Number.isFinite(greenDominance) && greenDominance > 90) {
          console.warn(
            `⚠️ [NDVI][HTTP] contrast_renderer_not_applied plotId=${plotId} ` +
              `range=${(Number(contrast.p95) - Number(contrast.p5)).toFixed(3)} ` +
              `greenDominance=${greenDominance.toFixed(1)}%`,
          );
          return res.status(422).json({
            success: false,
            code: 'contrast_renderer_not_applied',
            reason: 'green_dominated_preview_with_real_amplitude',
            details: {
              p5: contrast.p5,
              p50: contrast.p50,
              p95: contrast.p95,
              range: Number((Number(contrast.p95) - Number(contrast.p5)).toFixed(3)),
              greenDominance: Number(greenDominance.toFixed(1)),
              colorBuckets: buckets,
            },
          });
        }
      }

      const contrastValidation = validateNdviContrastHttpResponse(
        layer,
        requestedVisualMode,
        { requestBounds: this.service._boundsFromPolygon?.(polygon) ?? null },
      );

      console.log('[NDVI_FINAL_GATE]', {
        requestedVisualMode,
        resultVisualMode: contrastValidation.resultVisualMode,
        hasContrast: Boolean(contrastValidation.contrast),
        p5: contrastValidation.contrast?.p5 ?? null,
        p50: contrastValidation.contrast?.p50 ?? null,
        p95: contrastValidation.contrast?.p95 ?? null,
        validContrast: contrastValidation.ok,
      });

      console.log('[NDVI_BACKEND_FINAL_RESPONSE]', {
        requestedVisualMode,
        resultVisualMode: contrastValidation.resultVisualMode,
        hasContrast: contrastValidation.hasContrast,
        hasBounds: contrastValidation.hasBounds,
        p5: contrastValidation.contrast?.p5 ?? null,
        p50: contrastValidation.contrast?.p50 ?? null,
        p95: contrastValidation.contrast?.p95 ?? null,
        statusToReturn: contrastValidation.statusToReturn,
      });

      if (!contrastValidation.ok) {
        return res.status(422).json({
          success: false,
          code: 'ndvi_contrast_not_computed',
          reason: 'missing_visual_mode_or_contrast',
          message:
            'Modo ndvi_contrast exige visual_mode, contrast.p5/p50/p95, preview_url e bounds.',
          details: {
            requestedVisualMode,
            resultVisualMode: contrastValidation.resultVisualMode,
            hasContrast: contrastValidation.hasContrast,
            hasBounds: contrastValidation.hasBounds,
            p5: contrastValidation.contrast?.p5 ?? null,
            p50: contrastValidation.contrast?.p50 ?? null,
            p95: contrastValidation.contrast?.p95 ?? null,
          },
        });
      }

      layer = normalizeSuccessLayer(layer);
      res.status(201).json({ success: true, layer });
    } catch (error) {
      this._sendError(res, error);
    }
  }

  async attach(req, res) {
    try {
      const { campaignId } = req.params;
      const {
        farm_id: farmId,
        plot_id: plotId,
        layer_id: layerId,
        layer,
      } = req.body;

      const attached = await this.service.attachLayer({
        campaignId,
        farmId,
        plotId,
        layerId: layerId || layer?.layer_id,
        payload: req.body,
      });

      res.json({ success: true, layer: attached });
    } catch (error) {
      this._sendError(res, error);
    }
  }

  async getActive(req, res) {
    try {
      const { campaignId } = req.params;
      const { farm_id: farmId, plot_id: plotId } = req.query;

      const layer = await this.service.getActiveLayer({
        campaignId,
        farmId,
        plotId,
      });

      res.json({ success: true, layer });
    } catch (error) {
      this._sendError(res, error);
    }
  }

  async refresh(req, res) {
    try {
      const { campaignId } = req.params;
      const {
        farm_id: farmId,
        plot_id: plotId,
        polygon,
        start_date: startDate,
        end_date: endDate,
        max_cloud: maxCloud,
      } = req.body;

      const result = await this.service.refreshCampaign({
        campaignId,
        farmId,
        plotId,
        polygon,
        startDate,
        endDate,
        maxCloud: maxCloud != null ? Number(maxCloud) : 20,
      });

      res.json({ success: true, ...result });
    } catch (error) {
      this._sendError(res, error);
    }
  }

  async testCopernicusToken(req, res) {
    try {
      if (!this.authClient?.isConfigured()) {
        return res.status(503).json({
          success: false,
          configured: false,
          code: 'cdse_not_configured',
          message: 'CDSE_CLIENT_ID/SECRET não configurados',
        });
      }
      await this.authClient.getCdseAccessToken();
      res.json({ success: true, configured: true });
    } catch (error) {
      this._sendError(res, error);
    }
  }

  async getStatus(req, res) {
    try {
      const provider = this.service.getProviderStatus?.() || {};
      let database = 'unknown';
      try {
        await this.service.repository.ensureSchema();
        database = 'ok';
      } catch (dbError) {
        database = 'error';
        provider.database_error = dbError.message;
      }

      res.json({
        success: true,
        database,
        copernicus_token_configured: Boolean(this.authClient?.isConfigured?.()),
        ...provider,
      });
    } catch (error) {
      this._sendError(res, error);
    }
  }

  async getGeeHealth(req, res) {
    try {
      const health = this.service.getGeeHealth?.() || {};
      const httpStatus = health.readiness === 'ready' ? 200 : 503;
      res.status(httpStatus).json({
        success: health.readiness === 'ready',
        ...health,
      });
    } catch (error) {
      this._sendError(res, error);
    }
  }

  async getGeeTest(req, res) {
    try {
      const result = await runGeeSmokeTest();
      res.json(result);
    } catch (error) {
      const payload = await geeSmokeFailurePayload(error);
      const status = error?.status || 500;
      res.status(status).json(payload);
    }
  }

  _sendError(res, error) {
    const code = error.code || 'ndvi_error';
    let status = error.status || 500;
    let responseCode = code;

    if (code === 'NDVI_PROVIDER_ERROR') {
      status = error.status || 502;
    } else if (code === 'copernicus_error') {
      status = 502;
      responseCode = 'NDVI_PROVIDER_ERROR';
    } else if (code === 'copernicus_timeout') {
      status = 504;
      responseCode = 'NDVI_PROVIDER_ERROR';
    } else if (code === 'cdse_not_configured') {
      status = 503;
    } else if (code === 'gee_not_configured' || code === 'gee_disabled') {
      status = 503;
      responseCode = 'NDVI_PROVIDER_NOT_CONFIGURED';
    } else if (code === 'plot_polygon_missing' || code === 'invalid_polygon') {
      status = 400;
    } else if (code === 'invalid_image_date' || code === 'campaign_required') {
      status = 400;
    } else if (code === 'farm_scope_required' || code === 'plot_scope_required') {
      status = 400;
    } else if (code === 'empty_scenes' || code === 'ndvi_not_found') {
      status = 404;
    } else if (code === 'ndvi_not_computed' || code === 'ndvi_contrast_not_computed') {
      status = 422;
    } else if (
      code === 'layer_persist_failed' ||
      code === 'NDVI_SERVICE_UNAVAILABLE' ||
      code === 'ndvi_database_unavailable' ||
      code === '28P01'
    ) {
      status = 503;
      responseCode = 'NDVI_SERVICE_UNAVAILABLE';
    } else if (code === 'generate_failed') {
      status = error.details?.stage === 'persist' ? 500 : 502;
      if (!error.details?.stage) responseCode = 'NDVI_PROVIDER_ERROR';
    }

    const payload = {
      success: false,
      message: error.message || 'Erro interno no módulo NDVI',
      code: responseCode,
    };

    if (error.details && typeof error.details === 'object') {
      payload.details = error.details;
    }

    if (process.env.NODE_ENV !== 'production' && error.stack) {
      payload.debug = error.stack.split('\n').slice(0, 6);
    }

    console.error(
      `❌ [NDVI][HTTP] ${status} code=${responseCode} message=${payload.message}`,
    );

    res.status(status).json(payload);
  }
}

export default SoilSamplingNdviController;
