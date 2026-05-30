/**
 * Validação "ready agronômico" — exige stats NDVI + índices + classes.
 */

function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function countComputedIndices(stats) {
  let n = 0;
  if (toNum(stats?.ndre_mean ?? stats?.ndreMean) != null) n += 1;
  if (toNum(stats?.savi_mean ?? stats?.saviMean) != null) n += 1;
  if (toNum(stats?.bsi_mean ?? stats?.bsiMean) != null) n += 1;
  if (toNum(stats?.ndmi_mean ?? stats?.ndmiMean) != null) n += 1;
  return n;
}

export function hasAgronomicClassPercents(stats) {
  const keys = [
    'bare_soil_percent',
    'straw_percent',
    'low_vigor_percent',
    'medium_vigor_percent',
    'high_vigor_percent',
    'very_high_vigor_percent',
    'stress_candidate_percent',
  ];
  const vals = keys.map((k) => toNum(stats?.[k] ?? stats?.classes?.[k]));
  const present = vals.filter((v) => v != null && v >= 0);
  if (present.length < 3) return false;
  const sum = present.reduce((s, v) => s + v, 0);
  return sum >= 5 && sum <= 105;
}

export function isValidAgronomicNdviStats(stats) {
  if (!stats || typeof stats !== 'object') return false;

  const mean = toNum(stats.ndvi_mean ?? stats.ndviMean);
  const min = toNum(stats.ndvi_min ?? stats.ndviMin);
  const max = toNum(stats.ndvi_max ?? stats.ndviMax);
  const std = toNum(stats.ndvi_std ?? stats.ndviStd);

  if (mean == null || Math.abs(mean) < 1e-6) return false;
  if (min == null || max == null || min > mean || mean > max) return false;
  if (std == null || std < 0) return false;

  if (countComputedIndices(stats) < 3) return false;
  if (!hasAgronomicClassPercents(stats)) return false;

  return true;
}

export function invalidAgronomicReason(stats) {
  if (!stats) return 'stats_null';
  if (!toNum(stats.ndvi_mean ?? stats.ndviMean)) return 'ndvi_mean_missing';
  if (countComputedIndices(stats) < 3) return 'indices_insufficient';
  if (!hasAgronomicClassPercents(stats)) return 'class_percents_missing';
  return null;
}
