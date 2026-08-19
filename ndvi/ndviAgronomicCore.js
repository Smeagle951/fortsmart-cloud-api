/**
 * Índices e classificação agronômica Sentinel-2 L2A (espelho do evalscript + testes).
 *
 * Camadas:
 *   índice (medido) → classificação de superfície (estimada) → vigor (só com NDRE)
 * NDVI isolado NÃO classifica palhada. Sem evidência → SKIP (inconclusivo).
 */

export const AGRONOMIC_CLASS = {
  SKIP: 0,
  WATER_CLOUD_SHADOW: 1,
  BARE_SOIL: 2,
  STRAW: 3,
  LOW_VIGOR: 4,
  MEDIUM_VIGOR: 5,
  HIGH_VIGOR: 6,
  VERY_HIGH_VIGOR: 7,
  STRESS_CANDIDATE: 8,
};

export const ALGORITHM_VERSION = 'spectral_index_engine_v1';

const SCL_WATER_CLOUD = new Set([0, 1, 2, 3, 6, 8, 9, 10, 11]);

export function safeDiv(a, b) {
  const den = Number(b);
  if (!Number.isFinite(den) || Math.abs(den) < 1e-9) return null;
  const v = Number(a) / den;
  return Number.isFinite(v) ? v : null;
}

function band(sample, ...keys) {
  for (const key of keys) {
    if (sample[key] == null || sample[key] === '') continue;
    const n = Number(sample[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function computeIndices(sample) {
  const B02 = band(sample, 'B02', 'b02');
  const B04 = band(sample, 'B04', 'b04');
  const B05 = band(sample, 'B05', 'b05');
  const B08 = band(sample, 'B08', 'b08');
  const B8A = band(sample, 'B8A', 'b8a');
  const B11 = band(sample, 'B11', 'b11');
  const B12 = band(sample, 'B12', 'b12');
  const nirNarrow = B8A ?? B08;

  const ndvi = B08 != null && B04 != null ? safeDiv(B08 - B04, B08 + B04) : null;
  const ndre =
    nirNarrow != null && B05 != null ? safeDiv(nirNarrow - B05, nirNarrow + B05) : null;
  const saviNum =
    B08 != null && B04 != null ? safeDiv(B08 - B04, B08 + B04 + 0.5) : null;
  const savi = saviNum != null ? saviNum * 1.5 : null;
  const bsi =
    B11 != null && B04 != null && B08 != null && B02 != null
      ? safeDiv(B11 + B04 - (B08 + B02), B11 + B04 + B08 + B02)
      : null;
  const ndmi = B08 != null && B11 != null ? safeDiv(B08 - B11, B08 + B11) : null;
  const nbr2 = B11 != null && B12 != null ? safeDiv(B11 - B12, B11 + B12) : null;
  const msi = B08 != null && B11 != null ? safeDiv(B11, B08) : null;
  const swirRatio = B08 != null && B11 != null ? safeDiv(B11, B08) : null;

  return {
    ndvi,
    ndre,
    savi,
    bsi,
    ndmi,
    nbr2,
    ndti: nbr2,
    msi,
    swirRatio,
    B02,
    B04,
    B05,
    B08,
    B11,
    B12,
  };
}

export function isWaterCloudShadow(scl) {
  return SCL_WATER_CLOUD.has(Number(scl));
}

/**
 * Classificação pixel a pixel.
 * Sem NDRE não há vigor. Sem SWIR+B12 não há palhada. Caso contrário: SKIP.
 */
export function classifyAgronomicPixel(sample) {
  const scl = sample.SCL ?? sample.scl;
  if (sample.dataMask === 0) return AGRONOMIC_CLASS.SKIP;

  const { ndvi, ndre, bsi, ndmi, nbr2 } = computeIndices(sample);

  if (!Number.isFinite(ndvi)) return AGRONOMIC_CLASS.SKIP;
  if (isWaterCloudShadow(scl)) return AGRONOMIC_CLASS.WATER_CLOUD_SHADOW;

  if (Number.isFinite(bsi) && ndvi < 0.25 && bsi > 0.18) {
    return AGRONOMIC_CLASS.BARE_SOIL;
  }

  const strawEvidence =
    Number.isFinite(nbr2) &&
    ndvi >= 0.08 &&
    ndvi < 0.40 &&
    (!Number.isFinite(ndre) || ndre < 0.15) &&
    Number.isFinite(bsi) &&
    bsi > 0.02 &&
    bsi < 0.35 &&
    nbr2 > 0.02;
  if (strawEvidence) return AGRONOMIC_CLASS.STRAW;

  if (Number.isFinite(ndre) && ndvi >= 0.35 && ndre >= 0.18) {
    if (ndvi < 0.45) return AGRONOMIC_CLASS.LOW_VIGOR;
    if (ndvi < 0.65) return AGRONOMIC_CLASS.MEDIUM_VIGOR;
    if (ndvi <= 0.8) return AGRONOMIC_CLASS.HIGH_VIGOR;
    return AGRONOMIC_CLASS.VERY_HIGH_VIGOR;
  }

  if (
    Number.isFinite(ndre) &&
    ndvi >= 0.35 &&
    ndre < 0.18 &&
    (!Number.isFinite(ndmi) || ndmi < 0.15)
  ) {
    return AGRONOMIC_CLASS.STRESS_CANDIDATE;
  }

  return AGRONOMIC_CLASS.SKIP;
}

export function classIdToPercentKey(classId) {
  switch (classId) {
    case AGRONOMIC_CLASS.WATER_CLOUD_SHADOW:
      return 'water_cloud_shadow_percent';
    case AGRONOMIC_CLASS.BARE_SOIL:
      return 'bare_soil_percent';
    case AGRONOMIC_CLASS.STRAW:
      return 'straw_percent';
    case AGRONOMIC_CLASS.LOW_VIGOR:
      return 'low_vigor_percent';
    case AGRONOMIC_CLASS.MEDIUM_VIGOR:
      return 'medium_vigor_percent';
    case AGRONOMIC_CLASS.HIGH_VIGOR:
      return 'high_vigor_percent';
    case AGRONOMIC_CLASS.VERY_HIGH_VIGOR:
      return 'very_high_vigor_percent';
    case AGRONOMIC_CLASS.STRESS_CANDIDATE:
      return 'stress_candidate_percent';
    default:
      return null;
  }
}

export function encodeClassChannel(classId) {
  return Math.max(0, Math.min(255, Math.round((classId / 8) * 255)));
}

export function decodeClassChannel(gByte) {
  const g = Number(gByte) / 255;
  return Math.max(0, Math.min(8, Math.round(g * 8)));
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Agrega pixels decodificados do PNG empacotado.
 */
export function aggregateAgronomicPixels(pixels) {
  const ndviVals = [];
  const ndreVals = [];
  const saviVals = [];
  const bsiVals = [];
  const ndmiVals = [];
  const classCounts = {};

  for (const p of pixels) {
    if (!p.valid) continue;
    ndviVals.push(p.ndvi);
    if (Number.isFinite(p.ndre)) ndreVals.push(p.ndre);
    if (Number.isFinite(p.savi)) saviVals.push(p.savi);
    if (Number.isFinite(p.bsi)) bsiVals.push(p.bsi);
    if (Number.isFinite(p.ndmi)) ndmiVals.push(p.ndmi);
    const key = classIdToPercentKey(p.classId);
    if (key) classCounts[key] = (classCounts[key] || 0) + 1;
  }

  const total = ndviVals.length;
  if (total < 24) return null;

  ndviVals.sort((a, b) => a - b);
  const mean = ndviVals.reduce((s, v) => s + v, 0) / total;
  let sumSq = 0;
  for (const v of ndviVals) {
    const d = v - mean;
    sumSq += d * d;
  }

  const percents = {};
  for (const [key, count] of Object.entries(classCounts)) {
    percents[key] = Number(((count / total) * 100).toFixed(1));
  }

  const avg = (arr) =>
    arr.length ? Number((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(3)) : null;

  const water = percents.water_cloud_shadow_percent ?? 0;
  const bare = percents.bare_soil_percent ?? 0;
  const straw = percents.straw_percent ?? 0;
  const low = percents.low_vigor_percent ?? 0;
  const med = percents.medium_vigor_percent ?? 0;
  const high = percents.high_vigor_percent ?? 0;
  const veryHigh = percents.very_high_vigor_percent ?? 0;
  const stress = percents.stress_candidate_percent ?? 0;

  return {
    ndvi_mean: Number(mean.toFixed(3)),
    ndvi_min: Number(ndviVals[0].toFixed(3)),
    ndvi_max: Number(ndviVals[ndviVals.length - 1].toFixed(3)),
    ndvi_std: Number(Math.sqrt(sumSq / total).toFixed(3)),
    ndvi_p2: Number(percentile(ndviVals, 0.02).toFixed(3)),
    ndvi_p5: Number(percentile(ndviVals, 0.05).toFixed(3)),
    ndvi_p10: Number(percentile(ndviVals, 0.1).toFixed(3)),
    ndvi_p25: Number(percentile(ndviVals, 0.25).toFixed(3)),
    ndvi_p50: Number(percentile(ndviVals, 0.5).toFixed(3)),
    ndvi_p75: Number(percentile(ndviVals, 0.75).toFixed(3)),
    ndvi_p90: Number(percentile(ndviVals, 0.9).toFixed(3)),
    ndvi_p95: Number(percentile(ndviVals, 0.95).toFixed(3)),
    ndvi_p98: Number(percentile(ndviVals, 0.98).toFixed(3)),
    ndre_mean: avg(ndreVals),
    savi_mean: avg(saviVals),
    bsi_mean: avg(bsiVals),
    ndmi_mean: avg(ndmiVals),
    water_percent: water,
    cloud_shadow_percent: water,
    bare_soil_percent: bare,
    straw_percent: straw,
    low_vigor_percent: low,
    medium_vigor_percent: med,
    high_vigor_percent: high,
    very_high_vigor_percent: veryHigh,
    stress_candidate_percent: stress,
    very_low_percent: Number((bare + low * 0.5).toFixed(1)),
    low_percent: Number((low + straw * 0.3).toFixed(1)),
    medium_percent: med,
    high_percent: Number((high + veryHigh).toFixed(1)),
    valid_pixels: total,
    classes: {
      bareSoilPercent: bare,
      strawPercent: straw,
      lowVigorPercent: low,
      mediumVigorPercent: med,
      highVigorPercent: high,
      veryHighVigorPercent: veryHigh,
      stressCandidatePercent: stress,
      waterPercent: water,
    },
  };
}

/** Cores RGB [0..1] por classe (preview agronomic_classes). */
export const CLASS_PREVIEW_RGB = {
  [AGRONOMIC_CLASS.WATER_CLOUD_SHADOW]: [0.45, 0.48, 0.62],
  [AGRONOMIC_CLASS.BARE_SOIL]: [0.82, 0.71, 0.55],
  [AGRONOMIC_CLASS.STRAW]: [0.9, 0.82, 0.62],
  [AGRONOMIC_CLASS.LOW_VIGOR]: [0.84, 0.19, 0.15],
  [AGRONOMIC_CLASS.MEDIUM_VIGOR]: [0.98, 0.85, 0.35],
  [AGRONOMIC_CLASS.HIGH_VIGOR]: [0.55, 0.82, 0.4],
  [AGRONOMIC_CLASS.VERY_HIGH_VIGOR]: [0.12, 0.5, 0.22],
  [AGRONOMIC_CLASS.STRESS_CANDIDATE]: [0.55, 0.15, 0.45],
};

export function previewRgbForClass(classId) {
  return CLASS_PREVIEW_RGB[classId] || [0.5, 0.5, 0.5];
}
