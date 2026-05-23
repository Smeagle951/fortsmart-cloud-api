const NdviStatsService = require('./ndviStats.service');
const NdviResponseMapper = require('./ndviResponse.mapper');

class SoilSamplingNdviService {
  constructor({ repository, catalogClient, processClient }) {
    this.repository = repository;
    this.catalogClient = catalogClient;
    this.processClient = processClient;
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
    const scenes = await this.catalogClient.searchSentinelScenes({
      polygon,
      startDate,
      endDate,
      maxCloud,
    });
    console.log(
      `✅ [NDVI] searchScenes plotId=${plotId} count=${scenes.length} elapsedMs=${Date.now() - started}`,
    );
    return scenes;
  }

  /** Compatibilidade GET sem polygon — retorna vazio se polygon ausente. */
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
  }) {
    this._requireScope({ farmId, plotId });
    if (!polygon || polygon.type !== 'Polygon') {
      throw this._error('Talhão sem polígono válido', 'plot_polygon_missing', 400);
    }

    let targetSceneId = sceneId;
    let targetDate = imageDate;
    let targetCloud = cloudCoverage;

    if (!targetSceneId) {
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
      targetSceneId = best.scene_id || best.id;
      targetDate = best.image_date;
      targetCloud = best.cloud_coverage;
    }

    const cached = await this.repository.findRecentCache({
      farmId,
      plotId,
      imageDate: targetDate,
      maxCloud,
    });
    if (cached) {
      return NdviResponseMapper.mapLayer(cached);
    }

    const assets = await this.processClient.generateNdviLayer({
      sceneId: targetSceneId,
      polygon,
      imageDate: targetDate,
      farmId,
      plotId,
    });

    const stats = NdviStatsService.buildStats({
      ndviMean: null,
      ndviMin: null,
      ndviMax: null,
    });

    const layerId = String(targetSceneId);
    const saved = await this.repository.upsertLayer({
      id: layerId,
      farm_id: farmId,
      plot_id: plotId,
      campaign_id: campaignId,
      source: 'sentinel_2_l2a',
      image_date: targetDate,
      cloud_coverage: targetCloud,
      resolution_m: 10,
      ...stats,
      preview_url: assets.preview_url,
      tile_url: assets.tile_url,
      raster_url: assets.raster_url,
      is_active: false,
      status: assets.status || 'metadata_only',
    });

    return NdviResponseMapper.mapLayer(saved);
  }

  async attachLayer({ campaignId, farmId, plotId, layerId, payload = {} }) {
    if (!campaignId) {
      throw this._error('campaign_id é obrigatório', 'campaign_required', 400);
    }
    this._requireScope({ farmId, plotId });

    const layerPayload = payload.layer || payload;
    const resolvedLayerId =
      layerId || layerPayload.layer_id || layerPayload.id || payload.layer_id;

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
  }

  async getActiveLayer({ campaignId, farmId, plotId }) {
    if (!campaignId) {
      throw this._error('campaign_id é obrigatório', 'campaign_required', 400);
    }
    this._requireScope({ farmId, plotId });
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

  _requireScope({ farmId, plotId }) {
    if (!farmId || String(farmId).trim() === '') {
      throw this._error('farm_id é obrigatório', 'farm_scope_required', 400);
    }
    if (!plotId || String(plotId).trim() === '') {
      throw this._error('plot_id é obrigatório', 'plot_scope_required', 400);
    }
  }

  _error(message, code, status = 500) {
    const err = new Error(message);
    err.code = code;
    err.status = status;
    return err;
  }
}

module.exports = SoilSamplingNdviService;
