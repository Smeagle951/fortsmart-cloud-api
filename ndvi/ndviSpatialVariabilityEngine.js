function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 3) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function entropyFromValues(values, bins = 16) {
  const valid = Array.isArray(values)
    ? values.map(Number).filter((value) => Number.isFinite(value))
    : [];
  if (!valid.length) return null;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const span = Math.max(max - min, 1e-9);
  const counts = new Array(bins).fill(0);
  for (const value of valid) {
    const idx = Math.max(0, Math.min(bins - 1, Math.floor(((value - min) / span) * bins)));
    counts[idx] += 1;
  }
  let entropy = 0;
  for (const count of counts) {
    if (!count) continue;
    const p = count / valid.length;
    entropy -= p * Math.log2(p);
  }
  return round(entropy / Math.log2(bins), 4);
}

function severityFromScore(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 90) return 'very_high';
  if (n >= 60) return 'high';
  if (n >= 35) return 'moderate';
  return 'low';
}

export function buildNdviSpatialMetrics(stats = {}, values = null) {
  const p5 = num(stats.ndvi_p5 ?? stats.p5 ?? stats.contrast?.p5);
  const p25 = num(stats.ndvi_p25 ?? stats.p25 ?? stats.contrast?.p25);
  const p50 = num(stats.ndvi_p50 ?? stats.p50 ?? stats.contrast?.p50);
  const p75 = num(stats.ndvi_p75 ?? stats.p75 ?? stats.contrast?.p75);
  const p95 = num(stats.ndvi_p95 ?? stats.p95 ?? stats.contrast?.p95);
  const std = num(stats.ndvi_std ?? stats.std ?? stats.contrast?.std);
  const mean = num(stats.ndvi_mean);

  const ndviRange = p5 != null && p95 != null ? p95 - p5 : null;
  const coefficientOfVariation =
    std != null && mean != null && Math.abs(mean) > 1e-6 ? std / Math.abs(mean) : null;
  const valid = Array.isArray(values)
    ? values.map(Number).filter((value) => Number.isFinite(value))
    : null;
  const percentBelowP25 =
    valid?.length && p25 != null
      ? round((valid.filter((value) => value <= p25).length / valid.length) * 100, 1)
      : num(stats.percentBelowP25 ?? stats.percent_below_p25);
  const percentAboveP75 =
    valid?.length && p75 != null
      ? round((valid.filter((value) => value >= p75).length / valid.length) * 100, 1)
      : num(stats.percentAboveP75 ?? stats.percent_above_p75);

  const entropy = valid?.length ? entropyFromValues(valid) : num(stats.entropy);
  const rangeScore = ndviRange == null ? null : Math.min(100, Math.max(0, ndviRange / 0.002));
  const stdScore = std == null ? null : Math.min(100, Math.max(0, std / 0.0012));
  const entropyScore = entropy == null ? null : entropy * 100;
  const scoreParts = [rangeScore, stdScore, entropyScore].filter((v) => Number.isFinite(v));
  const contrastScore = scoreParts.length
    ? round(scoreParts.reduce((sum, value) => sum + value, 0) / scoreParts.length, 1)
    : null;
  const homogeneityScore =
    stats.homogeneity_score ??
    stats.homogeneityScore ??
    stats.contrast?.homogeneity ??
    (contrastScore == null ? null : round(100 - contrastScore, 1));

  return {
    homogeneityScore,
    contrastScore,
    contrastSeverity: severityFromScore(contrastScore),
    percentBelowP25,
    percentAboveP75,
    ndviRange: round(ndviRange),
    entropy,
    coefficientOfVariation: round(coefficientOfVariation, 4),
    p25,
    p50,
    p75,
  };
}

export function buildNdviRenderingMetadata({
  smoothing = 'median_3x3',
  interpolation = 'bilinear_4x',
} = {}) {
  return {
    smoothing,
    interpolation,
    statsSource: 'raw_pixels',
    previewSource: 'smoothed_visual',
  };
}
