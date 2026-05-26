/**
 * Validação final do payload HTTP de POST /generate.
 * Evita 201 com ndvi_mean/min/max zerados e percentuais inconsistentes.
 */
export const NDVI_VALIDATION_VERSION = 'v2';

function pickNum(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    const raw = obj[key];
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickUrl(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    const raw = obj[key];
    if (raw == null) continue;
    const text = String(raw).trim();
    if (text.length > 0) return text;
  }
  return null;
}

export function isValidNdviGenerateHttpPayload(result) {
  if (!result || typeof result !== 'object') return false;

  const preview = pickUrl(result, 'preview_url', 'previewUrl');
  const tile = pickUrl(result, 'tile_url', 'tileUrl');
  const raster = pickUrl(result, 'raster_url', 'rasterUrl');
  const hasPreview = Boolean(preview || tile || raster);
  if (!hasPreview) return false;

  const mean = pickNum(result, 'ndvi_mean', 'ndviMean');
  const min = pickNum(result, 'ndvi_min', 'ndviMin');
  const max = pickNum(result, 'ndvi_max', 'ndviMax');

  if (![mean, min, max].every((n) => n != null && Number.isFinite(n))) return false;
  if (min < -1 || max > 1) return false;
  if (min > mean || mean > max) return false;

  const vl = pickNum(result, 'very_low_percent', 'veryLowPercent');
  const lo = pickNum(result, 'low_percent', 'lowPercent');
  const md = pickNum(result, 'medium_percent', 'mediumPercent');
  const hi = pickNum(result, 'high_percent', 'highPercent');

  const hasClassDistribution =
    (vl != null && vl > 0) ||
    (lo != null && lo > 0) ||
    (md != null && md > 0) ||
    (hi != null && hi > 0);

  const allZero = mean === 0 && min === 0 && max === 0;
  if (allZero && hasClassDistribution) return false;
  if (allZero) return false;
  if (Math.abs(mean) < 1e-6) return false;

  return true;
}

export function readNdviGenerateStatsForDetails(result) {
  return {
    ndviMean: pickNum(result, 'ndvi_mean', 'ndviMean'),
    ndviMin: pickNum(result, 'ndvi_min', 'ndviMin'),
    ndviMax: pickNum(result, 'ndvi_max', 'ndviMax'),
  };
}
