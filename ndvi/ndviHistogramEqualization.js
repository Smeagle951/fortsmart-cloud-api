export const DEFAULT_EQUALIZATION = Object.freeze({
  enabled: true,
  method: 'clahe_light',
  clipLimit: 2.5,
  bins: 128,
});

function finiteValues(values) {
  return Array.isArray(values)
    ? values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= -1 && value <= 1)
    : [];
}

function round(value, digits = 4) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

export function shouldApplyLightClahe({
  visualMode = 'ndvi_contrast',
  p5,
  p95,
} = {}) {
  const mode = String(visualMode || '').toLowerCase();
  if (mode !== 'ndvi_contrast' && mode !== 'ndvi_relative') return false;
  const range = Number(p95) - Number(p5);
  return Number.isFinite(range) && range >= 0.04;
}

export function equalizationMetadata({ visualMode, p5, p95, clipLimit = 2.5 } = {}) {
  const enabled = shouldApplyLightClahe({ visualMode, p5, p95 });
  return {
    enabled,
    method: enabled ? 'clahe_light' : 'disabled_low_contrast_guard',
    clipLimit: enabled ? clipLimit : null,
  };
}

export function applyHistogramEqualization(
  values,
  { bins = 128, clipLimit = 2.5, p5 = null, p95 = null, visualMode = 'ndvi_contrast' } = {},
) {
  const source = finiteValues(values);
  if (!source.length || !shouldApplyLightClahe({ visualMode, p5, p95 })) {
    return values.map((value) => (Number.isFinite(Number(value)) ? Number(value) : null));
  }

  const min = Number.isFinite(Number(p5)) ? Number(p5) : Math.min(...source);
  const max = Number.isFinite(Number(p95)) ? Number(p95) : Math.max(...source);
  const span = Math.max(max - min, 1e-6);
  const histogram = new Array(bins).fill(0);
  const binFor = (value) =>
    Math.max(0, Math.min(bins - 1, Math.floor(((value - min) / span) * (bins - 1))));

  for (const value of source) {
    histogram[binFor(Math.max(min, Math.min(max, value)))] += 1;
  }

  const avgBin = source.length / bins;
  const maxBin = Math.max(1, avgBin * clipLimit);
  let excess = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    if (histogram[i] > maxBin) {
      excess += histogram[i] - maxBin;
      histogram[i] = maxBin;
    }
  }
  const redistribution = excess / bins;
  for (let i = 0; i < histogram.length; i += 1) {
    histogram[i] += redistribution;
  }

  const cdf = new Array(bins).fill(0);
  histogram.reduce((sum, count, index) => {
    cdf[index] = sum + count;
    return cdf[index];
  }, 0);
  const total = cdf[cdf.length - 1] || 1;

  return values.map((value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const clipped = Math.max(min, Math.min(max, n));
    const equalized = cdf[binFor(clipped)] / total;
    return round(equalized);
  });
}

export function countColorBucketsAfterEqualization(values, options = {}) {
  const eq = applyHistogramEqualization(values, options).filter((value) =>
    Number.isFinite(Number(value)),
  );
  const buckets = new Set();
  for (const value of eq) {
    buckets.add(Math.max(0, Math.min(7, Math.floor(Number(value) * 8))));
  }
  return buckets.size;
}
