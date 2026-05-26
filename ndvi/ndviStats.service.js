import { buildStatsOrNull, layerHasRaster } from './ndviValidity.js';

class NdviStatsService {
  static buildStats({ ndviMean, ndviMin, ndviMax, hasRaster = false } = {}) {
    return buildStatsOrNull({ ndviMean, ndviMin, ndviMax, hasRaster });
  }

  static buildStatsForAssets(assets) {
    const hasRaster = layerHasRaster({
      preview_url: assets?.preview_url,
      tile_url: assets?.tile_url,
      raster_url: assets?.raster_url,
    });
    return buildStatsOrNull({
      ndviMean: assets?.ndvi_mean ?? assets?.ndviMean,
      ndviMin: assets?.ndvi_min ?? assets?.ndviMin,
      ndviMax: assets?.ndvi_max ?? assets?.ndviMax,
      hasRaster,
      veryLowPercent: assets?.very_low_percent ?? assets?.veryLowPercent ?? null,
      lowPercent: assets?.low_percent ?? assets?.lowPercent ?? null,
      mediumPercent: assets?.medium_percent ?? assets?.mediumPercent ?? null,
      highPercent: assets?.high_percent ?? assets?.highPercent ?? null,
    });
  }
}

export default NdviStatsService;
