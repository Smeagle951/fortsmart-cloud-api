import { PNG } from 'pngjs';

const MIN_FINAL_COVERAGE_PCT = 70;

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a[1] > y) !== (b[1] > y) &&
        x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function insidePolygon(x, y, rings) {
  if (!pointInRing(x, y, rings[0])) return false;
  return !rings.slice(1).some((ring) => pointInRing(x, y, ring));
}

function finiteBounds(bounds) {
  const values = ['west', 'south', 'east', 'north'].map((key) => Number(bounds?.[key]));
  return values.every(Number.isFinite) && values[0] < values[2] && values[1] < values[3];
}

function polygonBounds(rings) {
  const points = rings[0];
  return {
    west: Math.min(...points.map((p) => p[0])),
    south: Math.min(...points.map((p) => p[1])),
    east: Math.max(...points.map((p) => p[0])),
    north: Math.max(...points.map((p) => p[1])),
  };
}

/** Validate the actual PNG footprint before its URL can be persisted as ready. */
export function validateRasterResult({ image, polygon, bounds, stats = {}, mode, final = false }) {
  const fail = (code, details = {}) => ({
    ok: false,
    code,
    layerStatus: code === 'INSUFFICIENT_COVERAGE' ? code : 'INVALID_GEOMETRY',
    ...details,
  });
  const rings = polygon?.type === 'Polygon' ? polygon.coordinates : null;
  if (!Buffer.isBuffer(image) || !Array.isArray(rings) || !Array.isArray(rings[0]) ||
      rings[0].length < 4 || !finiteBounds(bounds)) {
    return fail('INVALID_GEOMETRY');
  }
  let png;
  try {
    png = PNG.sync.read(image);
  } catch {
    return fail('INVALID_GEOMETRY', { reason: 'invalid_png' });
  }
  if (png.width <= 0 || png.height <= 0) return fail('INVALID_GEOMETRY');
  const expected = polygonBounds(rings);
  const lonPerPixel = (bounds.east - bounds.west) / png.width;
  const latPerPixel = (bounds.north - bounds.south) / png.height;
  if (['west', 'east'].some((key) => Math.abs(bounds[key] - expected[key]) > lonPerPixel) ||
      ['south', 'north'].some((key) => Math.abs(bounds[key] - expected[key]) > latPerPixel)) {
    return fail('INVALID_GEOMETRY', { reason: 'bounds_mismatch' });
  }

  let inside = 0;
  let valid = 0;
  let outside = 0;
  let outsideOpaque = 0;
  // Keep QA bounded even for historical 2048px previews. Sample spacing is
  // at most one pixel on the fast preview and four pixels on a 2048px PNG.
  const step = Math.max(1, Math.ceil(Math.max(png.width, png.height) / 512));
  for (let row = 0; row < png.height; row += step) {
    const lat = bounds.north - (row + 0.5) * latPerPixel;
    for (let col = 0; col < png.width; col += step) {
      const lon = bounds.west + (col + 0.5) * lonPerPixel;
      const alpha = png.data[(row * png.width + col) * 4 + 3];
      if (insidePolygon(lon, lat, rings)) {
        inside += 1;
        if (alpha >= 128) valid += 1;
      } else {
        outside += 1;
        if (alpha >= 128) outsideOpaque += 1;
      }
    }
  }
  const validPixelCoveragePct = inside > 0 ? (valid / inside) * 100 : 0;
  const outsideOpaquePct = outside > 0 ? (outsideOpaque / outside) * 100 : 0;
  const details = {
    width: png.width,
    height: png.height,
    validPixelCoveragePct: Number(validPixelCoveragePct.toFixed(2)),
    outsideOpaquePct: Number(outsideOpaquePct.toFixed(2)),
  };
  if (!inside || outsideOpaquePct > 1) {
    return fail('INVALID_GEOMETRY', { reason: 'alpha_footprint_mismatch', ...details });
  }
  // A partial preview must not be displayed either; only persistence differs.
  if (validPixelCoveragePct < MIN_FINAL_COVERAGE_PCT) {
    return fail('INSUFFICIENT_COVERAGE', details);
  }
  const numeric = [stats.ndvi_mean, stats.ndre_mean, stats.ndmi_mean, stats.bsi_mean]
    .filter((value) => value !== null && value !== undefined);
  if (numeric.some((value) => !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 1)) {
    return { ...fail('INVALID_RADIOMETRY', details), layerStatus: 'PROVIDER_ERROR' };
  }
  const sourceCoverage = Number(stats.validPixelPercent ??
    stats.valid_pixel_percent ?? stats.validPixelCoveragePct);
  if (Number.isFinite(sourceCoverage) &&
      Math.abs(sourceCoverage - validPixelCoveragePct) > 20) {
    return { ...fail('INVALID_RADIOMETRY', {
      reason: 'stats_coverage_disagrees_with_png', sourceCoverage,
      ...details,
    }), layerStatus: 'PROVIDER_ERROR' };
  }
  const min = Number(stats.ndvi_min);
  const mean = Number(stats.ndvi_mean);
  const max = Number(stats.ndvi_max);
  if ([min, mean, max].every(Number.isFinite) &&
      (min > mean || mean > max || min < -1 || max > 1)) {
    return { ...fail('INVALID_RADIOMETRY', { reason: 'ndvi_stats_order', ...details }),
      layerStatus: 'PROVIDER_ERROR' };
  }
  const rawPercentiles = [
    stats.ndvi_p5 ?? stats.contrast?.p5,
    stats.ndvi_p50 ?? stats.contrast?.p50,
    stats.ndvi_p95 ?? stats.contrast?.p95,
  ];
  const percentiles = rawPercentiles.map(Number);
  if (mode === 'ndvi_contrast' &&
      (rawPercentiles.some((value) => value == null) ||
       !percentiles.every(Number.isFinite) ||
       percentiles[0] > percentiles[1] || percentiles[1] > percentiles[2] ||
       percentiles[0] < -1 || percentiles[2] > 1)) {
    return { ...fail('INVALID_RADIOMETRY', details), layerStatus: 'PROVIDER_ERROR' };
  }
  return {
    ok: true,
    layerStatus: final ? 'FINAL_READY' : 'PREVIEW_READY',
    ...details,
  };
}
