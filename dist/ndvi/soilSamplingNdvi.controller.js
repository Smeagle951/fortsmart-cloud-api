import {
  isValidNdviGenerateHttpPayload,
  readNdviGenerateStatsForDetails,
} from './ndviGenerateHttpValidity.js';

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
      } = req.body;

      console.log(
        `ℹ️ [NDVI][HTTP] POST generate plotId=${plotId} farmId=${farmId} ` +
          `campaignId=${campaignId || '-'} sceneId=${sceneId || '-'} ` +
          `imageDate=${imageDate || '-'}`,
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

      const layer = await this.service.generateLayer({
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
      });

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

      res.status(201).json({ success: true, layer, data: layer });
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
    } else if (code === 'ndvi_not_computed') {
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
