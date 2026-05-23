class NdviStatsService {
  static buildStats({ ndviMean, ndviMin, ndviMax }) {
    const mean = Number.isFinite(Number(ndviMean)) ? Number(ndviMean) : 0.55;
    const min = Number.isFinite(Number(ndviMin)) ? Number(ndviMin) : Math.max(0, mean - 0.35);
    const max = Number.isFinite(Number(ndviMax)) ? Number(ndviMax) : Math.min(1, mean + 0.3);

    const veryLow = Math.max(0, Math.min(35, Math.round((0.35 - mean) * 40 + 8)));
    const low = Math.max(0, Math.min(45, Math.round((0.5 - mean) * 35 + 18)));
    const high = Math.max(0, Math.min(55, Math.round((mean - 0.45) * 40 + 24)));
    let medium = 100 - veryLow - low - high;
    if (medium < 0) medium = 0;

    return {
      ndvi_mean: Number(mean.toFixed(2)),
      ndvi_min: Number(min.toFixed(2)),
      ndvi_max: Number(max.toFixed(2)),
      very_low_percent: veryLow,
      low_percent: low,
      medium_percent: medium,
      high_percent: high,
    };
  }
}

module.exports = NdviStatsService;
