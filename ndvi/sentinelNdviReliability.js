export const NDVI_ENGINE_VERSION = 'sentinel_ndvi_reliable_v3';

export function normalizeReflectance(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return n > 2 ? n / 10000 : n;
}

export function safeNdvi(nir, red) {
  const n = normalizeReflectance(nir);
  const r = normalizeReflectance(red);
  if (!Number.isFinite(n) || !Number.isFinite(r)) return NaN;
  const denominator = n + r;
  if (Math.abs(denominator) < 0.000001) return NaN;
  const ndvi = (n - r) / denominator;
  return ndvi >= -1 && ndvi <= 1 ? ndvi : NaN;
}

export function isValidSclPixel(scl) {
  const value = Number(scl);
  return ![0, 1, 3, 6, 8, 9, 10, 11].includes(value);
}

export function percentile(values, p) {
  const finite = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!finite.length) return null;
  const rank = ((finite.length - 1) * p) / 100;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return finite[lower];
  const weight = rank - lower;
  return finite[lower] * (1 - weight) + finite[upper] * weight;
}

export function homogeneityFromContrast(contrast) {
  const value = Number(contrast);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, 1 - value / 0.2));
}

export function classifyRelativeNdviZone(value, percentiles) {
  const ndvi = Number(value);
  if (!Number.isFinite(ndvi)) return null;
  const p10 = Number(percentiles?.p10);
  const p30 = Number(percentiles?.p30);
  const p70 = Number(percentiles?.p70);
  const p90 = Number(percentiles?.p90);
  if (![p10, p30, p70, p90].every(Number.isFinite)) return null;
  if (ndvi < p10) return 'muito_abaixo';
  if (ndvi < p30) return 'abaixo';
  if (ndvi < p70) return 'padrao';
  if (ndvi < p90) return 'acima';
  return 'muito_acima';
}

export function buildNdviCacheKey({
  fieldId,
  sceneId,
  mode,
  opacity,
  cloudMaskVersion,
  statsVersion,
  polygonHash,
  ndviEngineVersion = NDVI_ENGINE_VERSION,
}) {
  return [
    fieldId,
    sceneId,
    mode,
    opacity,
    ndviEngineVersion,
    cloudMaskVersion,
    statsVersion,
    polygonHash,
  ].map((part) => String(part ?? '')).join(':');
}
