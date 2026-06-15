import {
  hasAgronomicClassPercents,
  isValidAgronomicNdviStats,
} from './ndviAgronomicValidity.js';

/**
 * Regras de validade NDVI — sem stats nem status "ready" falsos.
 */
export function hasUrl(value) {
  const text = value == null ? '' : String(value).trim();
  return text.length > 0;
}

function toNum(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isValidNdviMean(value, { hasRaster = false } = {}) {
  if (value == null || value === '') return false;
  const num = Number(value);
  if (!Number.isFinite(num)) return false;
  if (num < -1 || num > 1) return false;
  if (Math.abs(num) < 1e-6) return false;
  if (!hasRaster && num <= 0.01) return false;
  return true;
}

/**
 * Stats completas (mean/min/max + percentuais opcionais) — evita 201 com NDVI zerado
 * e percentuais inconsistentes.
 */
export function isValidNdviStats(stats) {
  if (!stats || typeof stats !== 'object') return false;
  if (isValidAgronomicNdviStats(stats)) return true;

  const mean = toNum(stats.ndvi_mean ?? stats.ndviMean);
  let min = toNum(stats.ndvi_min ?? stats.ndviMin);
  let max = toNum(stats.ndvi_max ?? stats.ndviMax);

  if (mean == null) return false;
  if (mean < -1 || mean > 1) return false;
  if (Math.abs(mean) < 1e-6) return false;

  if (min == null && mean != null) min = Math.max(-1, mean - 0.2);
  if (max == null && mean != null) max = Math.min(1, mean + 0.2);
  if (min == null || max == null) return false;
  if (min < -1 || max > 1) return false;
  if (min > mean || mean > max) return false;

  const vl = toNum(stats.very_low_percent ?? stats.veryLowPercent);
  const lo = toNum(stats.low_percent ?? stats.lowPercent);
  const md = toNum(stats.medium_percent ?? stats.mediumPercent);
  const hi = toNum(stats.high_percent ?? stats.highPercent);

  const hasPerc = [vl, lo, md, hi].every((p) => p != null);
  if (hasPerc) {
    const sum = vl + lo + md + hi;
    if (sum < 98.5 || sum > 101.5) return false;
    const spread = Math.max(vl, lo, md, hi) - Math.min(vl, lo, md, hi);
    if (spread > 1 && max - min < 0.02) return false;
  }

  return true;
}

export function layerHasRaster(row) {
  if (!row) return false;
  return (
    hasUrl(row.preview_url) ||
    hasUrl(row.tile_url) ||
    hasUrl(row.raster_url)
  );
}

/** Motivo para 422 ndvi_not_computed (contrato HTTP). */
export function invalidNdviStatsReason(stats) {
  if (!stats || typeof stats !== 'object') return 'stats_null';
  const mean = toNum(stats.ndvi_mean ?? stats.ndviMean);
  const min = toNum(stats.ndvi_min ?? stats.ndviMin);
  const max = toNum(stats.ndvi_max ?? stats.ndviMax);
  if (mean == null && min == null && max == null) return 'stats_null';
  if (
    mean != null &&
    min != null &&
    max != null &&
    Math.abs(mean) < 1e-6 &&
    Math.abs(min) < 1e-6 &&
    Math.abs(max) < 1e-6
  ) {
    return 'zero_stats';
  }
  if (!isValidNdviStats(stats)) return 'invalid_stats';
  return null;
}

export function isValidNdviLayerRow(row) {
  if (!row) return false;
  if (!layerHasRaster(row)) return false;
  const agro =
    row.agronomic_stats && typeof row.agronomic_stats === 'object'
      ? row.agronomic_stats
      : null;
  const merged = {
    ndvi_mean: row.ndvi_mean,
    ndvi_min: row.ndvi_min,
    ndvi_max: row.ndvi_max,
    ndvi_std: row.ndvi_std ?? agro?.ndvi_std,
    very_low_percent: row.very_low_percent,
    low_percent: row.low_percent,
    medium_percent: row.medium_percent,
    high_percent: row.high_percent,
    bare_soil_percent: row.bare_soil_percent ?? agro?.bare_soil_percent,
    straw_percent: row.straw_percent ?? agro?.straw_percent,
    low_vigor_percent: row.low_vigor_percent ?? agro?.low_vigor_percent,
    medium_vigor_percent: row.medium_vigor_percent ?? agro?.medium_vigor_percent,
    high_vigor_percent: row.high_vigor_percent ?? agro?.high_vigor_percent,
    very_high_vigor_percent:
      row.very_high_vigor_percent ?? agro?.very_high_vigor_percent,
    stress_candidate_percent:
      row.stress_candidate_percent ?? agro?.stress_candidate_percent,
    ndre_mean: row.ndre_mean ?? agro?.ndre_mean,
    savi_mean: row.savi_mean ?? agro?.savi_mean,
    bsi_mean: row.bsi_mean ?? agro?.bsi_mean,
    ndmi_mean: row.ndmi_mean ?? agro?.ndmi_mean,
    classes: row.classes ?? agro?.classes,
  };
  return isValidNdviStats(merged);
}

export { hasAgronomicClassPercents, isValidAgronomicNdviStats };

export function resolveLayerStatus(row) {
  const stored = String(row?.status || '').toLowerCase();
  if (stored === 'failed') return 'failed';

  const raster = layerHasRaster(row);

  if (raster && isValidNdviLayerRow(row)) {
    return 'ready';
  }
  if (stored === 'generated' || stored === 'metadata_only') {
    return 'metadata_only';
  }
  return 'metadata_only';
}

export function buildStatsOrNull({
  ndviMean,
  ndviMin,
  ndviMax,
  hasRaster = false,
  veryLowPercent = null,
  lowPercent = null,
  mediumPercent = null,
  highPercent = null,
} = {}) {
  if (!isValidNdviMean(ndviMean, { hasRaster })) {
    return {
      ndvi_mean: null,
      ndvi_min: null,
      ndvi_max: null,
      very_low_percent: null,
      low_percent: null,
      medium_percent: null,
      high_percent: null,
    };
  }
  const mean = Number(ndviMean);
  const min = Number.isFinite(Number(ndviMin)) ? Number(ndviMin) : Math.max(-1, mean - 0.2);
  const max = Number.isFinite(Number(ndviMax)) ? Number(ndviMax) : Math.min(1, mean + 0.2);
  const row = {
    ndvi_mean: Number(mean.toFixed(3)),
    ndvi_min: Number(min.toFixed(3)),
    ndvi_max: Number(max.toFixed(3)),
    very_low_percent: veryLowPercent,
    low_percent: lowPercent,
    medium_percent: mediumPercent,
    high_percent: highPercent,
  };
  if (!isValidNdviStats(row)) {
    return {
      ndvi_mean: null,
      ndvi_min: null,
      ndvi_max: null,
      very_low_percent: null,
      low_percent: null,
      medium_percent: null,
      high_percent: null,
    };
  }
  return row;
}
