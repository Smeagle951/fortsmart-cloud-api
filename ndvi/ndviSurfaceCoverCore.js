/**
 * Classificação de superfície Sentinel-2 L2A (CDSE).
 * Índices = medidos. Classe = estimada. Sem evidência → inconclusivo (0).
 */

export const SURFACE_COVER_ALGORITHM = 'surface_cover_cdse_v1';
export const SURFACE_COVER_MIN_CONFIDENCE = 0.6;

export const SURFACE_CLASS = {
  INCONCLUSIVE: 0,
  GREEN_RESIDUAL: 1,
  DRY_RESIDUE: 2,
  WET_RESIDUE: 3,
  BARE_DRY: 4,
  BARE_WET: 5,
  WATER: 6,
  MASKED: 7,
};

export const SURFACE_CLASS_META = Object.freeze({
  0: {
    id: 'unknown',
    label: 'Inconclusivo',
    countsInValidArea: true,
  },
  1: {
    id: 'greenResidualVegetation',
    label: 'Vegetação residual',
    countsInValidArea: true,
  },
  2: {
    id: 'probableDryResidue',
    label: 'Palhada seca provável',
    countsInValidArea: true,
  },
  3: {
    id: 'probableWetResidue',
    label: 'Palhada úmida aparente',
    countsInValidArea: true,
  },
  4: {
    id: 'probableBareDrySoil',
    label: 'Solo exposto seco',
    countsInValidArea: true,
  },
  5: {
    id: 'probableBareWetSoil',
    label: 'Solo exposto úmido',
    countsInValidArea: true,
  },
  6: {
    id: 'water',
    label: 'Água',
    countsInValidArea: true,
  },
  7: {
    id: 'masked',
    label: 'Mascarado',
    countsInValidArea: false,
  },
});

/** RGB 0–1 para preview categórico. Classe 0 é cinza visível. */
export const SURFACE_CLASS_RGB = {
  0: [0.86, 0.86, 0.86],
  1: [0.18, 0.49, 0.20],
  2: [0.78, 0.66, 0.42],
  3: [0.54, 0.48, 0.33],
  4: [0.71, 0.42, 0.23],
  5: [0.44, 0.38, 0.34],
  6: [0.18, 0.47, 0.72],
};

const SCL_MASKED = new Set([0, 1, 2, 3, 8, 9, 10, 11]);

export function isCdseSurfaceCoverMode(mode) {
  const m = String(mode || '')
    .trim()
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
  return (
    m === 'post_harvest_cover' ||
    m === 'bsi_soil' ||
    m === 'soil_cover_classification' ||
    m === 'soil_and_cover'
  );
}

function finite(v) {
  return v != null && Number.isFinite(Number(v));
}

function band(sample, ...keys) {
  for (const key of keys) {
    if (sample[key] == null || sample[key] === '') continue;
    const n = Number(sample[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function div(a, b) {
  if (!finite(b) || Math.abs(b) < 1e-9) return null;
  const v = a / b;
  return Number.isFinite(v) ? v : null;
}

export function computeSurfaceIndices(sample) {
  const B02 = band(sample, 'B02', 'b02');
  const B04 = band(sample, 'B04', 'b04');
  const B05 = band(sample, 'B05', 'b05');
  const B08 = band(sample, 'B08', 'b08');
  const B8A = band(sample, 'B8A', 'b8a');
  const B11 = band(sample, 'B11', 'b11');
  const B12 = band(sample, 'B12', 'b12');
  const nirNarrow = B8A ?? B08;

  return {
    ndvi: B08 != null && B04 != null ? div(B08 - B04, B08 + B04) : null,
    ndre:
      nirNarrow != null && B05 != null
        ? div(nirNarrow - B05, nirNarrow + B05)
        : null,
    savi:
      B08 != null && B04 != null
        ? (() => {
            const v = div(B08 - B04, B08 + B04 + 0.5);
            return v == null ? null : v * 1.5;
          })()
        : null,
    bsi:
      B11 != null && B04 != null && B08 != null && B02 != null
        ? div(B11 + B04 - (B08 + B02), B11 + B04 + B08 + B02)
        : null,
    ndmi: B08 != null && B11 != null ? div(B08 - B11, B08 + B11) : null,
    nbr2: B11 != null && B12 != null ? div(B11 - B12, B11 + B12) : null,
  };
}

function finalizeClass(code, confidence) {
  if (code === SURFACE_CLASS.MASKED || code === SURFACE_CLASS.WATER) {
    return { classCode: code, confidence };
  }
  if (confidence < SURFACE_COVER_MIN_CONFIDENCE) {
    return { classCode: SURFACE_CLASS.INCONCLUSIVE, confidence };
  }
  return { classCode: code, confidence };
}

/**
 * @returns {{ classCode: number, confidence: number }}
 */
export function classifySurfacePixel(sample) {
  if (sample.dataMask === 0) {
    return { classCode: SURFACE_CLASS.MASKED, confidence: 0 };
  }
  const scl = Number(sample.SCL ?? sample.scl);
  if (SCL_MASKED.has(scl)) {
    return { classCode: SURFACE_CLASS.MASKED, confidence: 0 };
  }
  if (scl === 6) {
    return { classCode: SURFACE_CLASS.WATER, confidence: 0.8 };
  }

  const { ndvi, ndre, savi, bsi, ndmi, nbr2 } = computeSurfaceIndices(sample);
  if (!finite(ndvi)) {
    return { classCode: SURFACE_CLASS.INCONCLUSIVE, confidence: 0.3 };
  }

  if (finite(bsi) && ndvi < 0.22 && bsi > 0.18) {
    if (finite(ndmi) && ndmi >= 0.05) {
      return finalizeClass(SURFACE_CLASS.BARE_WET, 0.7);
    }
    return finalizeClass(SURFACE_CLASS.BARE_DRY, 0.78);
  }

  if (
    finite(nbr2) &&
    ndvi >= 0.11 &&
    ndvi <= 0.32 &&
    (!finite(ndre) || ndre <= 0.15) &&
    (!finite(bsi) || bsi <= 0.15) &&
    nbr2 > 0.02
  ) {
    return finalizeClass(SURFACE_CLASS.DRY_RESIDUE, 0.65);
  }

  if (
    finite(ndmi) &&
    ndvi <= 0.3 &&
    ndmi >= 0.05 &&
    (!finite(bsi) || bsi < 0.1)
  ) {
    return finalizeClass(SURFACE_CLASS.WET_RESIDUE, 0.58);
  }

  if (
    ndvi >= 0.35 &&
    finite(ndre) &&
    ndre >= 0.2
  ) {
    return finalizeClass(SURFACE_CLASS.GREEN_RESIDUAL, 0.82);
  }

  return { classCode: SURFACE_CLASS.INCONCLUSIVE, confidence: 0.4 };
}

export function aggregateSurfaceClassPixels(pixels, { resolutionM = 20 } = {}) {
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  let confSum = 0;
  let confN = 0;

  for (const p of pixels) {
    const code = Number(p.classCode);
    if (!Number.isInteger(code) || code < 0 || code > 7) continue;
    counts[code] += 1;
    if (code !== SURFACE_CLASS.MASKED && finite(p.confidence)) {
      confSum += Number(p.confidence);
      confN += 1;
    }
  }

  const pixelAreaM2 = resolutionM * resolutionM;
  let validAreaM2 = 0;
  const rows = [];
  for (let code = 0; code <= 7; code += 1) {
    const meta = SURFACE_CLASS_META[code];
    const n = counts[code];
    if (!n) continue;
    const areaM2 = n * pixelAreaM2;
    if (meta.countsInValidArea) validAreaM2 += areaM2;
    rows.push({
      classCode: code,
      classId: meta.id,
      label: meta.label,
      areaM2,
      areaHa: Number((areaM2 / 10000).toFixed(4)),
      countsInValidArea: meta.countsInValidArea,
    });
  }

  const validPixelCount = Math.round(validAreaM2 / pixelAreaM2);
  if (validPixelCount <= 0) {
    return {
      status: 'insufficientData',
      validPixelCount: 0,
      validAreaHa: 0,
      classAreas: [],
      dominantClass: null,
      meanConfidence: null,
      algorithmVersion: SURFACE_COVER_ALGORITHM,
    };
  }

  const classAreas = rows
    .filter((row) => row.countsInValidArea)
    .map((row) => ({
      classCode: row.classCode,
      classId: row.classId,
      label: row.label,
      areaHa: row.areaHa,
      percentValidArea: Number(((row.areaM2 / validAreaM2) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.percentValidArea - a.percentValidArea);

  const byCode = (code) =>
    classAreas.find((c) => c.classCode === code)?.percentValidArea ?? 0;

  const dominant = classAreas[0] || null;
  return {
    status: 'ok',
    validPixelCount,
    validAreaHa: Number((validAreaM2 / 10000).toFixed(4)),
    classAreas,
    dominantClass: dominant
      ? { classCode: dominant.classCode, classId: dominant.classId }
      : null,
    meanConfidence: confN ? Number((confSum / confN).toFixed(3)) : null,
    bare_soil_percent: Number((byCode(4) + byCode(5)).toFixed(1)),
    straw_percent: Number((byCode(2) + byCode(3)).toFixed(1)),
    green_residual_percent: byCode(1),
    vegetation_cover_percent: byCode(1),
    inconclusive_percent: byCode(0),
    algorithmVersion: SURFACE_COVER_ALGORITHM,
    dataQuality: 'estimated',
  };
}

export function previewRgbForSurfaceClass(classCode) {
  return SURFACE_CLASS_RGB[classCode] || SURFACE_CLASS_RGB[0];
}
