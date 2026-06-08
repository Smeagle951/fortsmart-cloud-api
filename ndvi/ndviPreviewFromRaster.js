/**
 * Regenera preview visual a partir do raster persistido (sem Copernicus/GEE).
 */
import { PNG } from 'pngjs';
import { renderAgronomicContrastV2 } from './agronomicContrastRendererV2.js';
import { ndviToPreviewRgb, pickPreviewColormapMode } from './ndviColormap.js';
import { smoothPreviewPngBuffer } from './ndviSpatialSmoothing.js';
import { selectBandForVisualMode } from './ndviRasterLoader.js';
import { buildNdviZones } from './ndviZoneBuilder.js';
import { resolveContrastStretch } from './ndviContrastEngine.js';
import {
  buildNdviRenderingMetadata,
  buildNdviSpatialMetrics,
} from './ndviSpatialVariabilityEngine.js';
import {
  applyPolygonMaskToPngBuffer,
  applyInnerPixelBufferToValues,
  maskValuesToPolygon,
} from './ndviPolygonMask.js';

const CONTRAST_MODES = new Set([
  'ndvi_contrast',
  'ndvi_relative',
  'agronomic_classes',
]);
export const DEFAULT_PREVIEW_ALPHA = Math.round(0.85 * 255);

function round(value, digits = 3) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function statsForValues(values) {
  const valid = Array.isArray(values)
    ? values.map(Number).filter((value) => Number.isFinite(value) && value >= -1 && value <= 1)
    : [];
  if (!valid.length) return null;
  valid.sort((a, b) => a - b);
  const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  const variance =
    valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / valid.length;
  return {
    mean: round(mean),
    min: round(valid[0]),
    max: round(valid[valid.length - 1]),
    stdDev: round(Math.sqrt(variance), 4),
    p02: round(percentile(valid, 0.02)),
    p05: round(percentile(valid, 0.05)),
    p10: round(percentile(valid, 0.1)),
    p25: round(percentile(valid, 0.25)),
    p50: round(percentile(valid, 0.5)),
    p75: round(percentile(valid, 0.75)),
    p90: round(percentile(valid, 0.9)),
    p95: round(percentile(valid, 0.95)),
    p98: round(percentile(valid, 0.98)),
    count: valid.length,
  };
}

function percent(count, total) {
  return total > 0 ? round((count / total) * 100, 1) : null;
}

function classPercents(values) {
  const valid = values.map(Number).filter((value) => Number.isFinite(value));
  const total = valid.length;
  if (!total) return {};
  let veryLow = 0;
  let low = 0;
  let medium = 0;
  let high = 0;
  for (const value of valid) {
    if (value < 0.3) veryLow += 1;
    else if (value < 0.5) low += 1;
    else if (value < 0.8) medium += 1;
    else high += 1;
  }
  return {
    very_low_percent: percent(veryLow, total),
    low_percent: percent(low, total),
    medium_percent: percent(medium, total),
    high_percent: percent(high, total),
    classes: {
      veryLowPercent: percent(veryLow, total),
      lowVigorPercent: percent(low, total),
      mediumVigorPercent: percent(medium, total),
      highVigorPercent: percent(high, total),
    },
  };
}

function areaFromMaskStats(maskStats, resolutionM) {
  const pixelAreaHa = (Number(resolutionM || 10) * Number(resolutionM || 10)) / 10000;
  const validPixelCount = Number(maskStats?.validPixels ?? 0);
  const maskedPixelCount = Number(maskStats?.maskedPixels ?? 0);
  return {
    validPixelCount,
    maskedPixelCount,
    validAreaHa: round(validPixelCount * pixelAreaHa, 4),
    maskedAreaHa: round(maskedPixelCount * pixelAreaHa, 4),
  };
}

function diagnosisForStats(stats, sourceContext) {
  if (!stats || Number(stats.validPixelCount || 0) < 24) {
    return {
      status: 'incompleto',
      title: 'Dados insuficientes',
      interpretation: 'A camada reaproveitada não possui pixels válidos suficientes.',
      recommendation: 'Selecione outra imagem ou regenere a camada.',
      confidence: 0.25,
      reason: 'insufficient_valid_pixels',
    };
  }
  if (Number(stats.ndvi_mean) >= 0.75 && Number(stats.homogeneity_score) >= 70) {
    return {
      status: 'bom',
      title: 'Vigor alto',
      interpretation: 'Vigor alto com homogeneidade adequada para orientar a coleta.',
      recommendation: 'Realizar inspeção visual nas variações internas.',
      confidence: sourceContext?.sclMissing ? 0.62 : 0.82,
    };
  }
  return {
    status: Number(stats.contrast) >= 0.12 ? 'atencao' : 'bom',
    title: Number(stats.contrast) >= 0.12 ? 'Variação interna relevante' : 'Vigor consistente',
    interpretation:
      Number(stats.contrast) >= 0.12
        ? 'O talhão possui variação interna suficiente para orientar inspeção dirigida.'
        : 'A variação interna do talhão está controlada para esta cena.',
    recommendation: 'Cruzar as manchas com observação de campo antes de decidir manejo.',
    confidence: sourceContext?.sclMissing ? 0.55 : 0.75,
  };
}

function legendForMode(visualMode, stats) {
  if (visualMode === 'ndmi_water_stress') {
    return { title: 'Umidade NDMI', subtitle: 'Seco -> umido', unit: 'NDMI' };
  }
  if (visualMode === 'ndre') {
    return { title: 'Red Edge NDRE', subtitle: 'Baixo -> alto vigor foliar', unit: 'NDRE' };
  }
  if (visualMode === 'ndvi_absolute') {
    return { title: 'NDVI absoluto', subtitle: 'Escala fixa 0-1', unit: 'NDVI' };
  }
  return {
    title: 'NDVI contraste',
    subtitle: `cor = vigor relativo | p5 ${stats?.ndvi_p5 ?? '-'} | p50 ${stats?.ndvi_p50 ?? '-'} | p95 ${stats?.ndvi_p95 ?? '-'}`,
    unit: 'NDVI',
  };
}

export function valuesFromRasterBand(raster, visualMode) {
  const band = selectBandForVisualMode(raster, visualMode);
  const valid = raster.bands?.valid_mask;
  if (!band?.length) return [];
  const out = [];
  for (let i = 0; i < band.length; i += 1) {
    if (!valid?.[i]) {
      out.push(null);
      continue;
    }
    const v = Number(band[i]);
    out.push(Number.isFinite(v) && v > -9000 ? v : null);
  }
  return out;
}

export function rasterValuesToPngBuffer({
  values,
  width,
  height,
  visualMode,
  contrast,
  valuesAreVisual = false,
}) {
  const png = new PNG({ width, height });
  const mode = String(visualMode || 'ndvi_contrast');
  const lowContrastScene = contrast?.lowContrastScene === true;
  const colormapMode = mode === 'ndvi_absolute' || lowContrastScene
    ? 'absolute'
    : pickPreviewColormapMode(contrast, 'relative');
  const vmin = valuesAreVisual ? 0 : (contrast?.pLow ?? contrast?.p5 ?? 0);
  const vmax = valuesAreVisual ? 1 : (contrast?.pHigh ?? contrast?.p95 ?? 1);

  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    const o = i << 2;
    if (v == null || !Number.isFinite(v)) {
      png.data[o] = 0;
      png.data[o + 1] = 0;
      png.data[o + 2] = 0;
      png.data[o + 3] = 0;
      continue;
    }
    const rgb = ndviToPreviewRgb(v, {
      mode: CONTRAST_MODES.has(mode) && !lowContrastScene ? 'relative' : colormapMode,
      vmin,
      vmax,
    });
    if (!rgb) {
      png.data[o + 3] = 0;
      continue;
    }
    png.data[o] = Math.round(rgb[0] * 255);
    png.data[o + 1] = Math.round(rgb[1] * 255);
    png.data[o + 2] = Math.round(rgb[2] * 255);
    png.data[o + 3] = DEFAULT_PREVIEW_ALPHA;
  }

  return PNG.sync.write(png);
}

export function buildStatsFromRasterValues({
  raster,
  maskedNdviValues,
  maskStats,
  innerBufferStats = null,
  contrast,
  zones,
  spatialMetrics,
  visualMode = 'ndvi_contrast',
}) {
  const ndviStats = statsForValues(maskedNdviValues);
  if (!ndviStats) return null;
  const resolutionM = raster?.resolution_m ?? raster?.resolutionMeters ?? 10;
  const areaStats = areaFromMaskStats(maskStats, resolutionM);
  const classStats = classPercents(maskedNdviValues);
  const ndreStats = statsForValues(valuesFromRasterBand(raster, 'ndre'));
  const saviStats = statsForValues(valuesFromRasterBand(raster, 'savi'));
  const bsiStats = statsForValues(valuesFromRasterBand(raster, 'bsi_soil'));
  const ndmiStats = statsForValues(valuesFromRasterBand(raster, 'ndmi_water_stress'));
  const normalizedContrast = {
    ...(contrast || {}),
    p2: contrast?.p2 ?? ndviStats.p02,
    p5: contrast?.p5 ?? ndviStats.p05,
    p10: contrast?.p10 ?? ndviStats.p10,
    p25: contrast?.p25 ?? ndviStats.p25,
    p50: contrast?.p50 ?? ndviStats.p50,
    p75: contrast?.p75 ?? ndviStats.p75,
    p90: contrast?.p90 ?? ndviStats.p90,
    p95: contrast?.p95 ?? ndviStats.p95,
    p98: contrast?.p98 ?? ndviStats.p98,
    std: contrast?.std ?? ndviStats.stdDev,
  };
  const contrastValue = round((normalizedContrast.p95 ?? ndviStats.p95) - (normalizedContrast.p5 ?? ndviStats.p05), 4);
  const homogeneity = round(Math.max(0, Math.min(100, (1 - Math.min(contrastValue ?? 0, 0.2) / 0.2) * 100)), 1);
  const baseStats = {
    mean: ndviStats.mean,
    median: ndviStats.p50,
    min: ndviStats.min,
    max: ndviStats.max,
    p05: ndviStats.p05,
    p10: ndviStats.p10,
    p25: ndviStats.p25,
    p50: ndviStats.p50,
    p75: ndviStats.p75,
    p90: ndviStats.p90,
    p95: ndviStats.p95,
    stdDev: ndviStats.stdDev,
    contrast: contrastValue,
    homogeneity,
    ndvi_mean: ndviStats.mean,
    ndvi_min: ndviStats.min,
    ndvi_max: ndviStats.max,
    ndvi_std: ndviStats.stdDev,
    ndvi_p2: ndviStats.p02,
    ndvi_p5: ndviStats.p05,
    ndvi_p10: ndviStats.p10,
    ndvi_p25: ndviStats.p25,
    ndvi_p50: ndviStats.p50,
    ndvi_p75: ndviStats.p75,
    ndvi_p90: ndviStats.p90,
    ndvi_p95: ndviStats.p95,
    ndvi_p98: ndviStats.p98,
    homogeneity_score: homogeneity,
    contrast_score: round((1 - homogeneity / 100) * 100, 1),
    ...areaStats,
    valid_pixels: areaStats.validPixelCount,
    masked_pixels: areaStats.maskedPixelCount,
    ...classStats,
    ndre_mean: ndreStats?.mean ?? null,
    ndre_min: ndreStats?.min ?? null,
    ndre_max: ndreStats?.max ?? null,
    ndre_p5: ndreStats?.p05 ?? null,
    ndre_p50: ndreStats?.p50 ?? null,
    ndre_p95: ndreStats?.p95 ?? null,
    savi_mean: saviStats?.mean ?? null,
    bsi_mean: bsiStats?.mean ?? null,
    ndmi_mean: ndmiStats?.mean ?? null,
    ndmi_min: ndmiStats?.min ?? null,
    ndmi_max: ndmiStats?.max ?? null,
    ndmi_p5: ndmiStats?.p05 ?? null,
    ndmi_p50: ndmiStats?.p50 ?? null,
    ndmi_p95: ndmiStats?.p95 ?? null,
  };
  const spatial = {
    ...buildNdviSpatialMetrics(baseStats, maskedNdviValues),
    ...(spatialMetrics || {}),
  };
  baseStats.spatial_metrics = spatial;
  baseStats.rendering = buildNdviRenderingMetadata();
  baseStats.contrast = {
    ...normalizedContrast,
    contrast: contrastValue,
    homogeneity,
  };
  baseStats.zones = zones?.zones ?? zones ?? [];
  const sourceContext = {
    rasterReuse: true,
    statsRecomputed: true,
    statsSource: 'internal_grid',
    visualMode,
    rendererVersion: normalizedContrast.rendererVersion ?? null,
    cloudMaskVersion: 'scl_v2',
    statsVersion: 'stats_v2_inner_pixel_buffer',
    usedInnerBuffer: innerBufferStats?.usedInnerBuffer === true,
    innerBufferPixels: innerBufferStats?.innerBufferPixels ?? null,
    innerBufferMeters: innerBufferStats?.usedInnerBuffer ? resolutionM : null,
    innerBufferKeptPixels: innerBufferStats?.keptPixels ?? null,
    innerBufferRemovedBoundaryPixels: innerBufferStats?.removedBoundaryPixels ?? null,
    usedLowContrastFallback: normalizedContrast.usedLowContrastFallback === true,
    rasterWidth: raster?.width ?? null,
    rasterHeight: raster?.height ?? null,
    bounds: raster?.bounds ?? null,
    crs: raster?.crs ?? 'EPSG:4326',
    resolutionMeters: resolutionM,
    validPixelCount: areaStats.validPixelCount,
    maskedPixelCount: areaStats.maskedPixelCount,
  };
  return {
    stats: baseStats,
    diagnosis: diagnosisForStats(baseStats, sourceContext),
    legend: legendForMode(visualMode, baseStats),
    sourceContext,
  };
}

export function generatePreviewFromRaster({ raster, visualMode = 'ndvi_contrast', polygon = null }) {
  const mode = String(visualMode || 'ndvi_contrast');
  const width = raster.width;
  const height = raster.height;
  const rawValues = valuesFromRasterBand(raster, mode);
  const bounds = raster.bounds;
  const { values: maskedRawValues, maskStats } = maskValuesToPolygon({
    values: rawValues,
    width,
    height,
    bounds,
    polygon,
  });
  const { values: statsValues, bufferStats: innerBufferStats } =
    applyInnerPixelBufferToValues({
      values: maskedRawValues,
      width,
      height,
      radiusPx: 1,
    });
  const percentileValues = (innerBufferStats?.keptPixels ?? 0) >= 24
    ? statsValues
    : maskedRawValues;
  const finite = maskedRawValues.filter((v) => v != null && Number.isFinite(v));

  let contrast;
  let colorValues = maskedRawValues;
  let valuesAreVisual = false;

  let outWidth = width;
  let outHeight = height;

  if (CONTRAST_MODES.has(mode)) {
    const rendered = renderAgronomicContrastV2({
      values: maskedRawValues.map((v) => (v == null ? NaN : v)),
      statsValues: percentileValues.map((v) => (v == null ? NaN : v)),
      width,
      height,
      visualMode: mode,
    });
    contrast = rendered.contrast;
    colorValues = rendered.visualValues;
    valuesAreVisual = !contrast?.lowContrastScene;
    outWidth = rendered.width || width;
    outHeight = rendered.height || height;
  } else {
    const rendered = renderAgronomicContrastV2({
      values: maskedRawValues.map((v) => (v == null ? NaN : v)),
      statsValues: percentileValues.map((v) => (v == null ? NaN : v)),
      width,
      height,
      visualMode: 'ndvi_contrast',
    });
    contrast = {
      ...rendered.contrast,
      ...resolveContrastStretch(rendered.contrast),
    };
    colorValues = rendered.visualValues;
    outWidth = rendered.width || width;
    outHeight = rendered.height || height;
  }

  const zones = buildNdviZones({
    values: maskedRawValues,
    width,
    height,
    bounds,
    percentiles: contrast,
  });
  const statsBundle = buildStatsFromRasterValues({
    raster,
    maskedNdviValues: percentileValues,
    maskStats,
    innerBufferStats,
    contrast,
    zones,
    spatialMetrics: zones.spatialMetrics,
    visualMode: mode,
  });

  let buffer = rasterValuesToPngBuffer({
    values: colorValues,
    width: outWidth,
    height: outHeight,
    visualMode: mode,
    contrast,
    valuesAreVisual,
  });
  if (mode !== 'ndvi_contrast') {
    buffer = smoothPreviewPngBuffer(buffer);
  }
  buffer = applyPolygonMaskToPngBuffer(buffer, {
    bounds,
    polygon,
    alphaInside: DEFAULT_PREVIEW_ALPHA,
  });

  return {
    buffer,
    contrast,
    bounds,
    maskStats,
    zones: zones.zones,
    spatial_metrics: zones.spatialMetrics,
    stats: statsBundle?.stats ?? null,
    diagnosis: statsBundle?.diagnosis ?? null,
    legend: statsBundle?.legend ?? null,
    sourceContext: statsBundle?.sourceContext ?? null,
    visual_mode: mode,
    rasterReuse: true,
    statsProbe: {
      ndvi_mean: finite.length
        ? Number((finite.reduce((a, b) => a + b, 0) / finite.length).toFixed(4))
        : null,
      sampleCount: finite.length,
    },
  };
}
