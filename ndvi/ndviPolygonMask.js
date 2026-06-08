import { PNG } from 'pngjs';

/** Ray-casting point-in-polygon (anel GeoJSON [lng, lat]). */
export function pointInRing(lng, lat, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = Number(ring[i]?.[0]);
    const yi = Number(ring[i]?.[1]);
    const xj = Number(ring[j]?.[0]);
    const yj = Number(ring[j]?.[1]);
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(lng, lat, polygon) {
  const rings = polygon?.coordinates;
  if (!Array.isArray(rings) || !Array.isArray(rings[0])) return false;
  if (!pointInRing(lng, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(lng, lat, rings[i])) return false;
  }
  return true;
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const west = Number(bounds.west ?? bounds.left);
  const south = Number(bounds.south ?? bounds.bottom);
  const east = Number(bounds.east ?? bounds.right);
  const north = Number(bounds.north ?? bounds.top);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

function pixelToLngLat({ x, y, width, height, bounds }) {
  const { west, south, east, north } = bounds;
  return {
    lng: west + ((x + 0.5) / Math.max(width, 1)) * (east - west),
    lat: north - ((y + 0.5) / Math.max(height, 1)) * (north - south),
  };
}

export function buildPolygonMask({ width, height, bounds, polygon } = {}) {
  const box = normalizeBounds(bounds);
  if (!width || !height || !box || !polygon?.coordinates?.[0]?.length) {
    return null;
  }

  const totalPixels = width * height;
  const mask = new Uint8Array(totalPixels);
  let insidePolygonPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const { lng, lat } = pixelToLngLat({ x, y, width, height, bounds: box });
      const idx = y * width + x;
      if (pointInPolygon(lng, lat, polygon)) {
        mask[idx] = 1;
        insidePolygonPixels += 1;
      }
    }
  }

  return {
    mask,
    width,
    height,
    bounds: box,
    totalPixels,
    insidePolygonPixels,
  };
}

export function maskValuesToPolygon({
  values,
  width,
  height,
  bounds,
  polygon,
} = {}) {
  if (!Array.isArray(values)) {
    return { values, maskStats: null };
  }

  const polygonMask = buildPolygonMask({ width, height, bounds, polygon });
  if (!polygonMask) {
    const validPixels = values.filter((value) => {
      const n = Number(value);
      return Number.isFinite(n) && n >= -1 && n <= 1;
    }).length;
    return {
      values: values.map((value) => {
        const n = Number(value);
        return Number.isFinite(n) && n >= -1 && n <= 1 ? n : null;
      }),
      maskStats: {
        totalPixels: values.length,
        insidePolygonPixels: values.length,
        validPixels,
        transparentPixels: values.length - validPixels,
        outsidePolygonTransparent: false,
      },
    };
  }

  let validPixels = 0;
  let transparentPixels = 0;
  const masked = values.map((value, idx) => {
    const n = Number(value);
    const inside = polygonMask.mask[idx] === 1;
    if (!inside || !Number.isFinite(n) || n < -1 || n > 1) {
      transparentPixels += 1;
      return null;
    }
    validPixels += 1;
    return n;
  });

  return {
    values: masked,
    maskStats: {
      totalPixels: polygonMask.totalPixels,
      insidePolygonPixels: polygonMask.insidePolygonPixels,
      validPixels,
      transparentPixels,
      outsidePolygonTransparent: true,
    },
  };
}

export function applyInnerPixelBufferToValues({
  values,
  width,
  height,
  radiusPx = 1,
} = {}) {
  if (!Array.isArray(values) || !width || !height || radiusPx <= 0) {
    return { values, bufferStats: null };
  }

  const out = new Array(values.length).fill(null);
  let keptPixels = 0;
  let removedBoundaryPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const value = Number(values[idx]);
      if (!Number.isFinite(value) || value < -1 || value > 1) {
        continue;
      }

      let touchesBoundary = false;
      for (let yy = y - radiusPx; yy <= y + radiusPx && !touchesBoundary; yy += 1) {
        for (let xx = x - radiusPx; xx <= x + radiusPx; xx += 1) {
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) {
            touchesBoundary = true;
            break;
          }
          const neighbor = Number(values[yy * width + xx]);
          if (!Number.isFinite(neighbor) || neighbor < -1 || neighbor > 1) {
            touchesBoundary = true;
            break;
          }
        }
      }

      if (touchesBoundary) {
        removedBoundaryPixels += 1;
        continue;
      }
      out[idx] = value;
      keptPixels += 1;
    }
  }

  return {
    values: out,
    bufferStats: {
      usedInnerBuffer: true,
      innerBufferPixels: radiusPx,
      keptPixels,
      removedBoundaryPixels,
    },
  };
}

function logMaskAlpha(stats) {
  if (!stats) return;
  console.log('[NDVI_MASK_ALPHA]');
  console.log(`totalPixels=${stats.totalPixels}`);
  console.log(`insidePolygonPixels=${stats.insidePolygonPixels}`);
  console.log(`validPixels=${stats.validPixels}`);
  console.log(`transparentPixels=${stats.transparentPixels}`);
  console.log(`outsidePolygonTransparent=${stats.outsidePolygonTransparent === true}`);
}

/**
 * Torna transparentes os pixels do PNG fora do polígono do talhão.
 */
export function applyPolygonMaskToPngBuffer(
  buffer,
  { bounds, polygon, alphaInside = 210, log = true } = {},
) {
  if (!buffer?.length) return buffer;

  const png = PNG.sync.read(buffer);
  const w = png.width;
  const h = png.height;
  if (!w || !h) return buffer;

  const polygonMask = buildPolygonMask({ width: w, height: h, bounds, polygon });
  if (!polygonMask) return buffer;

  let validPixels = 0;
  let transparentPixels = 0;
  const visibleAlpha = Math.max(180, Math.min(220, Number(alphaInside) || 210));

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) << 2;
      const inside = polygonMask.mask[y * w + x] === 1;
      if (!inside || png.data[o + 3] < 16) {
        png.data[o] = 0;
        png.data[o + 1] = 0;
        png.data[o + 2] = 0;
        png.data[o + 3] = 0;
        transparentPixels += 1;
        continue;
      }
      png.data[o + 3] = visibleAlpha;
      validPixels += 1;
    }
  }

  if (log) {
    logMaskAlpha({
      totalPixels: w * h,
      insidePolygonPixels: polygonMask.insidePolygonPixels,
      validPixels,
      transparentPixels,
      outsidePolygonTransparent: true,
    });
  }

  return PNG.sync.write(png);
}
