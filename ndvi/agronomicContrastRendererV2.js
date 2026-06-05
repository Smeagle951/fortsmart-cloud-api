import {
  applyContrastStretch,
  calculatePercentiles,
} from './ndviContrastEngine.js';
import {
  applyHistogramEqualization,
  equalizationMetadata,
} from './ndviHistogramEqualization.js';
import { medianFilter3x3, bilinearUpscale } from './ndviSpatialSmoothing.js';

const RENDERER_VERSION = 'agronomic_contrast_v2_1';

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
  const p2 = Number(percentiles.p2);
  const p5 = Number(percentiles.p5);
  const p95 = Number(percentiles.p95);
  const p98 = Number(percentiles.p98);
  if (Number.isFinite(p5) && Number.isFinite(p95) && p95 - p5 >= 0.05) {
    return {
      pLow: p5,
      pHigh: p95,
      stretchMode: 'p5_p95',
      lowContrastScene: false,
    };
  }
  const lowContrastScene =
    !(Number.isFinite(p2) && Number.isFinite(p98) && p98 - p2 >= 0.03);
  return {
    pLow: Number.isFinite(p2) ? p2 : p5,
    pHigh: Number.isFinite(p98) ? p98 : p95,
    stretchMode: 'p2_p98',
    lowContrastScene,
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
  width,
  height,
  visualMode = 'ndvi_contrast',
} = {}) {
  const rawValues = finiteNdviValues(values);
  const percentiles = calculatePercentiles(rawValues);
  const stretch = resolveStretch(percentiles);
  const gamma = gammaForDistribution(percentiles);
  const sourceValues = values.map((value) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= -1 && n <= 1 ? n : null;
  });
  const stretched = sourceValues.map((value) =>
    value == null ? null : applyContrastStretch(value, stretch.pLow, stretch.pHigh),
  );
  const gammaCorrected = stretched.map((value) =>
    value == null ? null : round(Math.pow(value, gamma), 4),
  );
  // Low contrast scenes are agronomically homogeneous. Do not force CLAHE or a
  // full red→green spread, otherwise a healthy high-NDVI field looks critical.
  const equalized = stretch.lowContrastScene
    ? sourceValues
    : applyHistogramEqualization(gammaCorrected, {
        p5: 0,
        p95: 1,
        visualMode,
        clipLimit: 2.5,
      });
  const smoothed =
    width && height && width * height === equalized.length
      ? medianFilter3x3(equalized, width, height)
      : equalized;
  const upscaled =
    width && height && width * height === smoothed.length
      ? bilinearUpscale(smoothed, width, height, 4)
      : { values: smoothed, width, height };

  const contrast = {
    ...percentiles,
    std: std(rawValues),
    lowContrastScene: stretch.lowContrastScene,
    stretchMode: stretch.stretchMode,
    rendererVersion: RENDERER_VERSION,
    gamma,
    equalization: equalizationMetadata({
      visualMode,
      p5: percentiles.p5,
      p95: percentiles.p95,
      clipLimit: 2.5,
    }),
    smoothing: {
      enabled: true,
      median3x3: Boolean(width && height),
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
