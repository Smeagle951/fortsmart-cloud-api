import { layerHasRaster } from './ndviValidity.js';

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

class NdviStatsService {
  static buildStatsForAssets(assets) {
    const hasRaster = layerHasRaster({
      preview_url: assets?.preview_url,
      tile_url: assets?.tile_url,
      raster_url: assets?.raster_url,
    });

    const raw = assets?.stats && typeof assets.stats === 'object' ? assets.stats : assets;
    const classes = assets?.classes || raw?.classes || {};

    return {
      ndvi_mean: num(raw?.ndvi_mean ?? raw?.ndviMean),
      ndvi_min: num(raw?.ndvi_min ?? raw?.ndviMin),
      ndvi_max: num(raw?.ndvi_max ?? raw?.ndviMax),
      ndvi_std: num(raw?.ndvi_std ?? raw?.ndviStd),
      ndvi_p10: num(raw?.ndvi_p10 ?? raw?.ndviP10),
      ndvi_p25: num(raw?.ndvi_p25 ?? raw?.ndviP25),
      ndvi_p50: num(raw?.ndvi_p50 ?? raw?.ndviP50),
      ndvi_p75: num(raw?.ndvi_p75 ?? raw?.ndviP75),
      ndvi_p90: num(raw?.ndvi_p90 ?? raw?.ndviP90),
      ndre_mean: num(raw?.ndre_mean ?? raw?.ndreMean),
      ndre_min: num(raw?.ndre_min ?? raw?.ndreMin),
      ndre_max: num(raw?.ndre_max ?? raw?.ndreMax),
      ndre_p5: num(raw?.ndre_p5 ?? raw?.ndreP5),
      ndre_p50: num(raw?.ndre_p50 ?? raw?.ndreP50),
      ndre_p95: num(raw?.ndre_p95 ?? raw?.ndreP95),
      lowChlorophyllPercent: num(raw?.lowChlorophyllPercent ?? raw?.low_chlorophyll_percent),
      highChlorophyllPercent: num(raw?.highChlorophyllPercent ?? raw?.high_chlorophyll_percent),
      savi_mean: num(raw?.savi_mean ?? raw?.saviMean),
      bsi_mean: num(raw?.bsi_mean ?? raw?.bsiMean),
      ndmi_mean: num(raw?.ndmi_mean ?? raw?.ndmiMean),
      ndmi_min: num(raw?.ndmi_min ?? raw?.ndmiMin),
      ndmi_max: num(raw?.ndmi_max ?? raw?.ndmiMax),
      ndmi_p5: num(raw?.ndmi_p5 ?? raw?.ndmiP5),
      ndmi_p50: num(raw?.ndmi_p50 ?? raw?.ndmiP50),
      ndmi_p95: num(raw?.ndmi_p95 ?? raw?.ndmiP95),
      waterStressPercent: num(raw?.waterStressPercent ?? raw?.water_stress_percent),
      adequateMoisturePercent: num(raw?.adequateMoisturePercent ?? raw?.adequate_moisture_percent),
      highMoisturePercent: num(raw?.highMoisturePercent ?? raw?.high_moisture_percent),
      very_low_percent: num(raw?.very_low_percent ?? raw?.veryLowPercent),
      low_percent: num(raw?.low_percent ?? raw?.lowPercent),
      medium_percent: num(raw?.medium_percent ?? raw?.mediumPercent),
      high_percent: num(raw?.high_percent ?? raw?.highPercent),
      bare_soil_percent:
        num(raw?.bare_soil_percent) ?? num(classes?.bareSoilPercent),
      straw_percent: num(raw?.straw_percent) ?? num(classes?.strawPercent),
      low_vigor_percent:
        num(raw?.low_vigor_percent) ?? num(classes?.lowVigorPercent),
      medium_vigor_percent:
        num(raw?.medium_vigor_percent) ?? num(classes?.mediumVigorPercent),
      high_vigor_percent:
        num(raw?.high_vigor_percent) ?? num(classes?.highVigorPercent),
      very_high_vigor_percent:
        num(raw?.very_high_vigor_percent) ?? num(classes?.veryHighVigorPercent),
      stress_candidate_percent:
        num(raw?.stress_candidate_percent) ?? num(classes?.stressCandidatePercent),
      water_percent: num(raw?.water_percent) ?? num(classes?.waterPercent),
      visual_mode: assets?.visual_mode ?? raw?.visual_mode ?? null,
      processing_engine: assets?.processing_engine ?? null,
      classes,
      has_raster: hasRaster,
    };
  }
}

export default NdviStatsService;
