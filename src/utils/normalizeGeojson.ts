import { HttpError } from '../middleware/errorHandler.js';

export type GeoJsonPolygon = {
  type: 'Polygon';
  coordinates: number[][][];
};

function isNumberArrayPair(p: unknown): p is [number, number] {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    typeof p[0] === 'number' &&
    typeof p[1] === 'number' &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1])
  );
}

/** Valida GeoJSON mínimo tipo Polygon (anel fechado com ≥ 4 vértices). */
export function normalizeGeojson(input: unknown): GeoJsonPolygon {
  if (typeof input !== 'object' || input === null) {
    throw new HttpError('geojson must be an object', 400);
  }
  const o = input as Record<string, unknown>;
  if (o.type !== 'Polygon') {
    throw new HttpError('geojson.type must be Polygon', 400);
  }
  const coords = o.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) {
    throw new HttpError('geojson.coordinates invalid', 400);
  }
  const ring = coords[0];
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new HttpError('geojson ring must have at least 4 positions', 400);
  }
  for (const p of ring) {
    if (!isNumberArrayPair(p)) {
      throw new HttpError('geojson ring positions must be [lng, lat] numbers', 400);
    }
  }
  const first = ring[0] as [number, number];
  const last = ring[ring.length - 1] as [number, number];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw new HttpError('geojson ring must be closed', 400);
  }
  return { type: 'Polygon', coordinates: coords as number[][][] };
}

export function tryNormalizeGeojson(input: unknown): GeoJsonPolygon | null {
  try {
    return normalizeGeojson(input);
  } catch {
    return null;
  }
}
