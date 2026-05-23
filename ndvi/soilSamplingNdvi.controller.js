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

  async getScenes(req, res) {
    try {
      const { plotId } = req.params;
      const {
        farm_id: farmId,
        campaign_id: campaignId,
        start_date: startDate,
        end_date: endDate,
      } = req.query;

      if (!farmId || !startDate || !endDate) {
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
          message: 'CDSE_CLIENT_ID/SECRET não configurados',
        });
      }
      await this.authClient.getCdseAccessToken();
      res.json({ success: true, configured: true });
    } catch (error) {
      this._sendError(res, error);
    }
  }

  _sendError(res, error) {
    const code = error.code || 'ndvi_error';
    let status = error.status || 500;

    if (code === 'copernicus_error') status = 502;
    if (code === 'copernicus_timeout') status = 504;
    if (code === 'plot_polygon_missing') status = 400;
    if (code === 'empty_scenes' || code === 'ndvi_not_found') status = 404;

    res.status(status).json({
      success: false,
      message: error.message || 'Erro interno no módulo NDVI',
      code,
    });
  }
}

export default SoilSamplingNdviController;
