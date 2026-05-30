const INVALID_CLASS_IDS = new Set([0, 1]);

export const CONTRAST_PERCENTILES = [2, 5, 10, 25, 50, 75, 90, 95, 98];

export function isValidNdviValue(value, meta = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  if (meta.nodata === true || meta.cloud === true || meta.shadow === true) {
    return false;
  }
  if (meta.water === true) return false;
  if (INVALID_CLASS_IDS.has(Number(meta.classId))) return false;
  return n >= -1 && n <= 1;
}

export function calculatePercentiles(values, percentiles = CONTRAST_PERCENTILES) {
  const sorted = values
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v >= -1 && v <= 1)
    .sort((a, b) => a - b);

  const result = {};
  if (!sorted.length) {
    for (const p of percentiles) result[`p${p}`] = null;
    return result;
  }

  for (const p of percentiles) {
    const idx = ((sorted.length - 1) * p) / 100;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const value =
      lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    result[`p${p}`] = Number(value.toFixed(3));
  }
  return result;
}

export function resolveContrastStretch(percentiles) {
  const p2 = Number(percentiles?.p2);
  const p5 = Number(percentiles?.p5);
  const p95 = Number(percentiles?.p95);
  const p98 = Number(percentiles?.p98);

  if (Number.isFinite(p5) && Number.isFinite(p95) && p95 - p5 >= 0.08) {
    return {
      pLow: p5,
      pHigh: p95,
      stretchMode: 'p5_p95',
      lowContrastScene: false,
    };
  }

  const lowContrastScene = !(Number.isFinite(p2) && Number.isFinite(p98) && p98 - p2 >= 0.05);
  return {
    pLow: Number.isFinite(p2) ? p2 : p5,
    pHigh: Number.isFinite(p98) ? p98 : p95,
    stretchMode: 'p2_p98',
    lowContrastScene,
  };
}

export function applyContrastStretch(value, pLow, pHigh) {
  const v = Number(value);
  const low = Number(pLow);
  const high = Number(pHigh);
  if (!Number.isFinite(v) || !Number.isFinite(low) || !Number.isFinite(high)) {
    return null;
  }
  const span = Math.max(high - low, 1e-6);
  return Math.max(0, Math.min(1, (v - low) / span));
}

function rgb(hex) {
  const clean = hex.replace('#', '');
  return [
    Number.parseInt(clean.slice(0, 2), 16) / 255,
    Number.parseInt(clean.slice(2, 4), 16) / 255,
    Number.parseInt(clean.slice(4, 6), 16) / 255,
  ];
}

const CONTRAST_STOPS = [
  { max: 0.15, rgb: rgb('#7f0000'), bucket: 'very_low_relative' },
  { max: 0.30, rgb: rgb('#d7301f'), bucket: 'low_relative' },
  { max: 0.45, rgb: rgb('#fdae61'), bucket: 'orange_relative' },
  { max: 0.60, rgb: rgb('#ffffbf'), bucket: 'mid_relative' },
  { max: 0.75, rgb: rgb('#a6d96a'), bucket: 'light_green_relative' },
  { max: 0.90, rgb: rgb('#1a9850'), bucket: 'green_relative' },
  { max: 1.01, rgb: rgb('#006837'), bucket: 'very_high_relative' },
];

const ABSOLUTE_STOPS = [
  { max: 0.20, rgb: rgb('#d73027'), bucket: 'absolute_very_low' },
  { max: 0.35, rgb: rgb('#fc8d59'), bucket: 'absolute_low' },
  { max: 0.50, rgb: rgb('#fee08b'), bucket: 'absolute_medium_low' },
  { max: 0.65, rgb: rgb('#91cf60'), bucket: 'absolute_medium' },
  { max: 0.78, rgb: rgb('#5ec962'), bucket: 'absolute_high' },
  { max: 0.88, rgb: rgb('#34a853'), bucket: 'absolute_very_high' },
  { max: 1.01, rgb: rgb('#1a9850'), bucket: 'absolute_peak' },
];

function colorFromStops(value, stops) {
  const v = Math.max(0, Math.min(1, Number(value)));
  for (const stop of stops) {
    if (v < stop.max) return stop.rgb;
  }
  return stops[stops.length - 1].rgb;
}

export function contrastBucket(value) {
  const v = Math.max(0, Math.min(1, Number(value)));
  return CONTRAST_STOPS.find((stop) => v < stop.max)?.bucket || 'very_high_relative';
}

export function renderAgronomicContrastColor(value) {
  return colorFromStops(value, CONTRAST_STOPS);
}

export function renderAbsoluteNdviColor(value) {
  return colorFromStops(value, ABSOLUTE_STOPS);
}

export function renderRelativeNdviColor(value, min, max) {
  return renderAgronomicContrastColor(applyContrastStretch(value, min, max));
}

export function smoothRaster3x3(values, width, height) {
  const out = new Array(values.length).fill(null);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const neighbors = [];
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy += 1) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx += 1) {
          const v = Number(values[yy * width + xx]);
          if (Number.isFinite(v)) neighbors.push(v);
        }
      }
      neighbors.sort((a, b) => a - b);
      out[y * width + x] = neighbors.length
        ? neighbors[Math.floor(neighbors.length / 2)]
        : null;
    }
  }
  return out;
}

export function buildContrastMetadata(values) {
  const percentiles = calculatePercentiles(values);
  const stretch = resolveContrastStretch(percentiles);
  return {
    ...percentiles,
    lowContrastScene: stretch.lowContrastScene,
    stretchMode: stretch.stretchMode,
    pLow: stretch.pLow,
    pHigh: stretch.pHigh,
  };
}

export function colorBucketsForValues(values, contrast) {
  const buckets = {};
  const pLow = contrast?.pLow ?? contrast?.p5;
  const pHigh = contrast?.pHigh ?? contrast?.p95;
  for (const value of values) {
    const t = applyContrastStretch(value, pLow, pHigh);
    if (t == null) continue;
    const key = contrastBucket(t);
    buckets[key] = (buckets[key] || 0) + 1;
  }
  return buckets;
}
