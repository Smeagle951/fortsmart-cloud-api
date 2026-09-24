/**
 * Validação HTTP POST /generate — ready agronômico (v3).
 */

import { countComputedIndices, hasAgronomicClassPercents } from './ndviAgronomicValidity.js';
import { hasCoreRenderableNdviStats, isValidNdviStats } from './ndviValidity.js';

export const NDVI_HTTP_VALIDATION_VERSION = 'v3';

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

function mergedStats(result) {
  const stats = result?.stats && typeof result.stats === 'object' ? result.stats : {};
  const classes = result?.classes && typeof result.classes === 'object' ? result.classes : {};
  return {
    ...stats,
    ndvi_mean: pickNum(result, 'ndvi_mean', 'ndviMean') ?? pickNum(stats, 'ndvi_mean'),
    ndvi_min: pickNum(result, 'ndvi_min', 'ndviMin') ?? pickNum(stats, 'ndvi_min'),
    ndvi_max: pickNum(result, 'ndvi_max', 'ndviMax') ?? pickNum(stats, 'ndvi_max'),
    ndvi_std: pickNum(result, 'ndvi_std', 'ndviStd') ?? pickNum(stats, 'ndvi_std'),
    ndre_mean: pickNum(result, 'ndre_mean', 'ndreMean') ?? pickNum(stats, 'ndre_mean'),
    savi_mean: pickNum(result, 'savi_mean', 'saviMean') ?? pickNum(stats, 'savi_mean'),
    bsi_mean: pickNum(result, 'bsi_mean', 'bsiMean') ?? pickNum(stats, 'bsi_mean'),
    ndmi_mean: pickNum(result, 'ndmi_mean', 'ndmiMean') ?? pickNum(stats, 'ndmi_mean'),
    bare_soil_percent:
      pickNum(result, 'bare_soil_percent') ?? pickNum(classes, 'bareSoilPercent'),
    straw_percent: pickNum(result, 'straw_percent') ?? pickNum(classes, 'strawPercent'),
    low_vigor_percent:
      pickNum(result, 'low_vigor_percent') ?? pickNum(classes, 'lowVigorPercent'),
    medium_vigor_percent:
      pickNum(result, 'medium_vigor_percent') ?? pickNum(classes, 'mediumVigorPercent'),
    high_vigor_percent:
      pickNum(result, 'high_vigor_percent') ?? pickNum(classes, 'highVigorPercent'),
    very_high_vigor_percent:
      pickNum(result, 'very_high_vigor_percent') ?? pickNum(classes, 'veryHighVigorPercent'),
    stress_candidate_percent:
      pickNum(result, 'stress_candidate_percent') ??
      pickNum(classes, 'stressCandidatePercent'),
    classes,
  };
}

export function isValidNdviGenerateHttpPayload(result) {
  if (!result || typeof result !== 'object') return false;

  const preview = pickUrl(result, 'preview_url', 'previewUrl');
  const raster = pickUrl(result, 'raster_url', 'rasterUrl');
  if (!preview && !raster) return false;

  const s = mergedStats(result);
  const mean = s.ndvi_mean;
  const min = s.ndvi_min;
  const max = s.ndvi_max;

  if (mean == null || min == null || max == null) return false;
  if (min > mean || mean > max) return false;
  if (Math.abs(mean) < 1e-6) return false;

  const visualMode = String(
    result?.visual_mode ?? result?.visualMode ?? 'ndvi_contrast',
  )
    .trim()
    .toLowerCase();
  const contrastRaw =
    result?.contrast ??
    result?.stats?.contrast ??
    parseAgronomicContrast(result);
  if (visualMode === 'ndvi_contrast' || visualMode === 'contrast') {
    const contrastStats = {
      ...s,
      contrast: contrastRaw,
      ndvi_p5: pickNum(result, 'ndvi_p5', 'ndviP5') ?? pickNum(contrastRaw, 'p5'),
      ndvi_p50: pickNum(result, 'ndvi_p50', 'ndviP50') ?? pickNum(contrastRaw, 'p50'),
      ndvi_p95: pickNum(result, 'ndvi_p95', 'ndviP95') ?? pickNum(contrastRaw, 'p95'),
      validPixelCount:
        pickNum(result, 'valid_pixel_count', 'validPixelCount') ??
        pickNum(s, 'valid_pixels'),
    };
    if (hasCoreRenderableNdviStats(contrastStats)) {
      return true;
    }
  }

  // NDVI absoluto / índices: stats clássicas (mean/min/max) + preview — não exige pacote v3 completo.
  if (isValidNdviStats(s)) {
    return true;
  }

  if (countComputedIndices(s) < 3) return false;
  if (!hasAgronomicClassPercents(s)) return false;

  return true;
}

function parseAgronomicContrast(result) {
  const raw = result?.agronomic_stats ?? result?.agronomicStats;
  if (raw == null) return null;
  if (typeof raw === 'object') return raw.contrast ?? null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw)?.contrast ?? null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

export function readNdviGenerateStatsForDetails(result) {
  const s = mergedStats(result);
  return {
    ndviMean: s.ndvi_mean,
    ndviMin: s.ndvi_min,
    ndviMax: s.ndvi_max,
    ndreMean: s.ndre_mean,
    bareSoilPercent: s.bare_soil_percent,
    stressCandidatePercent: s.stress_candidate_percent,
  };
}
