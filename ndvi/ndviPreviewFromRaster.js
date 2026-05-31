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
  applyPolygonMaskToPngBuffer,
  maskValuesToPolygon,
} from './ndviPolygonMask.js';

const CONTRAST_MODES = new Set([
  'ndvi_contrast',
  'ndvi_relative',
  'agronomic_classes',
]);

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

export function rasterValuesToPngBuffer({ values, width, height, visualMode, contrast }) {
  const png = new PNG({ width, height });
  const mode = String(visualMode || 'ndvi_contrast');
  const colormapMode =
    mode === 'ndvi_absolute' ? 'absolute' : pickPreviewColormapMode(contrast, 'relative');
  const vmin = contrast?.pLow ?? contrast?.p5 ?? 0;
  const vmax = contrast?.pHigh ?? contrast?.p95 ?? 1;

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
      mode: CONTRAST_MODES.has(mode) ? 'relative' : colormapMode,
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
    png.data[o + 3] = 210;
  }

  return PNG.sync.write(png);
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
  const finite = maskedRawValues.filter((v) => v != null && Number.isFinite(v));

  let contrast;
  let colorValues = maskedRawValues;

  let outWidth = width;
  let outHeight = height;

  if (CONTRAST_MODES.has(mode)) {
    const rendered = renderAgronomicContrastV2({
      values: maskedRawValues.map((v) => (v == null ? NaN : v)),
      width,
      height,
      visualMode: mode,
    });
    contrast = rendered.contrast;
    colorValues = rendered.visualValues;
    outWidth = rendered.width || width;
    outHeight = rendered.height || height;
  } else {
    const rendered = renderAgronomicContrastV2({
      values: maskedRawValues.map((v) => (v == null ? NaN : v)),
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

  let buffer = rasterValuesToPngBuffer({
    values: colorValues,
    width: outWidth,
    height: outHeight,
    visualMode: mode,
    contrast,
  });
  buffer = smoothPreviewPngBuffer(buffer);
  buffer = applyPolygonMaskToPngBuffer(buffer, {
    bounds,
    polygon,
    alphaInside: 210,
  });

  return {
    buffer,
    contrast,
    bounds,
    maskStats,
    zones: zones.zones,
    spatial_metrics: zones.spatialMetrics,
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
