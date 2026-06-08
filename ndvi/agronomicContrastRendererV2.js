import {
  applyContrastStretch,
  calculatePercentiles,
} from './ndviContrastEngine.js';
import { bilinearUpscale } from './ndviSpatialSmoothing.js';

const RENDERER_VERSION = 'agronomic_contrast_v7_inner_buffer';

function finiteNdviValues(values) {
  return Array.isArray(values)
    ? values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= -1 && value <= 1)
    : [];
}

function round(value, digits = 3) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function std(values) {
  const valid = finiteNdviValues(values);
  if (!valid.length) return null;
  const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  const variance =
    valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / valid.length;
  return round(Math.sqrt(variance), 4);
}

function resolveStretch(percentiles) {
  const p5 = Number(percentiles.p5);
  const p50 = Number(percentiles.p50);
  const p95 = Number(percentiles.p95);
  if (Number.isFinite(p5) && Number.isFinite(p95) && p95 - p5 >= 0.01) {
    return {
      pLow: p5,
      pHigh: p95,
      stretchMode: 'p5_p95',
      lowContrastScene: false,
      usedLowContrastFallback: false,
    };
  }
  const center = Number.isFinite(p50) ? p50 : Number(percentiles.mean ?? 0.5);
  return {
    pLow: center - 0.03,
    pHigh: center + 0.03,
    stretchMode: 'mean_window_0_06',
    lowContrastScene: true,
    usedLowContrastFallback: true,
  };
}

function gammaForDistribution(percentiles) {
  const p25 = Number(percentiles.p25);
  const p50 = Number(percentiles.p50);
  const p75 = Number(percentiles.p75);
  if (![p25, p50, p75].every(Number.isFinite) || p75 <= p25) return 0.92;
  const skew = (p75 + p25 - 2 * p50) / Math.max(p75 - p25, 1e-6);
  return round(Math.max(0.75, Math.min(1.15, 0.95 + skew * 0.12)), 3);
}

function bucketName(t) {
  const v = Math.max(0, Math.min(1, Number(t)));
  if (v < 0.3) return 'redPercent';
  if (v < 0.45) return 'orangePercent';
  if (v < 0.6) return 'yellowPercent';
  if (v < 0.75) return 'lightGreenPercent';
  if (v < 0.9) return 'greenPercent';
  return 'darkGreenPercent';
}

function colorBuckets(values) {
  const valid = finiteNdviValues(values);
  const out = {
    redPercent: 0,
    orangePercent: 0,
    yellowPercent: 0,
    lightGreenPercent: 0,
    greenPercent: 0,
    darkGreenPercent: 0,
  };
  if (!valid.length) return out;
  for (const value of valid) out[bucketName(value)] += 1;
  for (const key of Object.keys(out)) {
    out[key] = round((out[key] / valid.length) * 100, 1);
  }
  return out;
}

export function renderAgronomicContrastV2({
  values,
  statsValues = null,
  width,
  height,
  visualMode = 'ndvi_contrast',
} = {}) {
  const rawValues = finiteNdviValues(statsValues ?? values);
  const percentiles = calculatePercentiles(rawValues);
  const stretch = resolveStretch(percentiles);
  const gamma = visualMode === 'ndvi_contrast' ? 1 : gammaForDistribution(percentiles);
  const sourceValues = values.map((value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= -1 && n <= 1 ? n : null;
  });
  const stretched = sourceValues.map((value) =>
    value == null ? null : applyContrastStretch(value, stretch.pLow, stretch.pHigh),
  );
  const visualValues = stretched.map((value) =>
    value == null ? null : round(Math.pow(value, gamma), 4),
  );
  const smoothed =
    width && height && width * height === visualValues.length ? visualValues : visualValues;
  const upscaled =
    width && height && width * height === smoothed.length
      ? bilinearUpscale(smoothed, width, height, 4)
      : { values: smoothed, width, height };

  const contrast = {
    ...percentiles,
    std: std(rawValues),
    lowContrastScene: stretch.lowContrastScene,
    stretchMode: stretch.stretchMode,
    pLow: round(stretch.pLow, 4),
    pHigh: round(stretch.pHigh, 4),
    usedLowContrastFallback: stretch.usedLowContrastFallback,
    rendererVersion: RENDERER_VERSION,
    gamma,
    equalization: {
      enabled: false,
      method: 'disabled_percentile_direct',
    },
    smoothing: {
      enabled: true,
      median3x3: false,
      interpolation: 'bilinear_4x',
    },
    colorBuckets: colorBuckets(upscaled.values),
  };

  return {
    contrast,
    visualValues: upscaled.values,
    width: upscaled.width,
    height: upscaled.height,
  };
}

export { RENDERER_VERSION };
