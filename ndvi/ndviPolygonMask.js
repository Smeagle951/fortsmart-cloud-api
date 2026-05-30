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

/**
 * Torna transparentes os pixels do PNG fora do polígono do talhão.
 */
export function applyPolygonMaskToPngBuffer(buffer, { bounds, polygon } = {}) {
  if (!buffer?.length) return buffer;
  const ring = polygon?.coordinates?.[0];
  const box = normalizeBounds(bounds);
  if (!Array.isArray(ring) || ring.length < 3 || !box) return buffer;

  const png = PNG.sync.read(buffer);
  const { west, south, east, north } = box;
  const w = png.width;
  const h = png.height;
  if (!w || !h) return buffer;

  for (let y = 0; y < h; y += 1) {
    const lat = north - (y / Math.max(h - 1, 1)) * (north - south);
    for (let x = 0; x < w; x += 1) {
      const lng = west + (x / Math.max(w - 1, 1)) * (east - west);
      if (pointInRing(lng, lat, ring)) continue;
      const o = (y * w + x) << 2;
      png.data[o + 3] = 0;
    }
  }

  return PNG.sync.write(png);
}
