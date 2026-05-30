import { PNG } from 'pngjs';
import { aggregateAgronomicPixels, decodeClassChannel } from './ndviAgronomicCore.js';
import { equalizationMetadata } from './ndviHistogramEqualization.js';
import {
  buildNdviRenderingMetadata,
  buildNdviSpatialMetrics,
} from './ndviSpatialVariabilityEngine.js';

function readPackedPixels(buffer, { decodeIndices = false } = {}) {
  if (!buffer?.length || buffer[0] !== 0x89) return null;
  let png;
  try {
    png = PNG.sync.read(buffer);
  } catch {
    return null;
  }

  const { data, width, height } = png;
  const pixels = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (width * y + x) << 2;
      const a = data[i + 3];
      if (a < 40) continue;

      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      if (!decodeIndices) {
        const ndvi = r * 2 - 1;
        const classId = decodeClassChannel(Math.round(g * 255));
        const ndre = b * 2 - 1;
        pixels.push({
          valid: classId > 0,
          ndvi,
          classId,
          ndre,
        });
      } else {
        pixels.push({
          valid: true,
          savi: r * 2 - 1,
          bsi: g * 2 - 1,
          ndmi: b * 2 - 1,
        });
      }
    }
  }

  return { pixels, width, height };
}

export function computeAgronomicStatsFromPackedPngs(
  primaryBuffer,
  indicesBuffer,
  { sceneId = '-' } = {},
) {
  const primary = readPackedPixels(primaryBuffer);
  if (!primary?.pixels?.length) {
    console.warn(`⚠️ [NDVI][AgroStats] primary vazio sceneId=${sceneId}`);
    return null;
  }

  const base = aggregateAgronomicPixels(primary.pixels);
  if (!base) {
    console.warn(
          `⚠️ [NDVI][AgroStats] pixels insuficientes sceneId=${sceneId} n=${primary.pixels.length}`,
    );
    return null;
  }

  if (indicesBuffer) {
    const idxPixels = readPackedPixels(indicesBuffer, { decodeIndices: true });
    if (idxPixels?.pixels?.length) {
      const saviVals = [];
      const bsiVals = [];
      const ndmiVals = [];
      for (const p of idxPixels.pixels) {
        if (!p.valid) continue;
        if (Number.isFinite(p.savi)) saviVals.push(p.savi);
        if (Number.isFinite(p.bsi)) bsiVals.push(p.bsi);
        if (Number.isFinite(p.ndmi)) ndmiVals.push(p.ndmi);
      }
      const avg = (arr) =>
        arr.length
          ? Number((arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(3))
          : null;
      if (saviVals.length) base.savi_mean = avg(saviVals);
      if (bsiVals.length) base.bsi_mean = avg(bsiVals);
      if (ndmiVals.length) base.ndmi_mean = avg(ndmiVals);
    }
  }

  const ndviValues = primary
    .pixels
    .filter((p) => p.valid && Number.isFinite(p.ndvi))
    .map((p) => p.ndvi);
  const spatialMetrics = buildNdviSpatialMetrics(base, ndviValues);
  base.homogeneity_score = spatialMetrics.homogeneityScore;
  base.contrast_score = spatialMetrics.contrastScore;
  base.contrast_severity = spatialMetrics.contrastSeverity;
  base.percent_below_p25 = spatialMetrics.percentBelowP25;
  base.percent_above_p75 = spatialMetrics.percentAboveP75;
  base.spatial_metrics = spatialMetrics;
  base.rendering = buildNdviRenderingMetadata();
  base.contrast = {
    ...(base.contrast || {}),
    p5: base.ndvi_p5,
    p10: base.ndvi_p10,
    p25: base.ndvi_p25,
    p50: base.ndvi_p50,
    p75: base.ndvi_p75,
    p90: base.ndvi_p90,
    p95: base.ndvi_p95,
    std: base.ndvi_std,
    homogeneity: spatialMetrics.homogeneityScore,
    equalization: equalizationMetadata({
      visualMode: 'ndvi_contrast',
      p5: base.ndvi_p5,
      p95: base.ndvi_p95,
    }),
  };
  Object.defineProperty(base, '_ndvi_grid', {
    value: {
      values: primary.pixels.map((p) => (p.valid && Number.isFinite(p.ndvi) ? p.ndvi : null)),
      width: primary.width,
      height: primary.height,
    },
    enumerable: false,
  });

  console.log(
    `✅ [NDVI][AgroStats] sceneId=${sceneId} mean=${base.ndvi_mean} ` +
      `bare=${base.bare_soil_percent}% straw=${base.straw_percent}% ` +
      `high=${base.high_vigor_percent}% veryHigh=${base.very_high_vigor_percent}% ` +
      `stress=${base.stress_candidate_percent}% ndre=${base.ndre_mean}`,
  );
  console.log(
    `[NDVI][Equalization] sceneId=${sceneId} enabled=${base.contrast.equalization.enabled} ` +
      `method=${base.contrast.equalization.method} clipLimit=${base.contrast.equalization.clipLimit ?? '-'} ` +
      `range=${spatialMetrics.ndviRange ?? '-'} contrastSeverity=${spatialMetrics.contrastSeverity ?? '-'}`,
  );

  return base;
}
