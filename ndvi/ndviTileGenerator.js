/**
 * Geração de tiles PNG derivados do internal_grid (zoom 10–18).
 * Preparado para Google Maps / Leaflet / Mapbox / Flutter Map.
 */
import { PNG } from 'pngjs';
import { generatePreviewFromRaster } from './ndviPreviewFromRaster.js';

const MIN_ZOOM = 10;
const MAX_ZOOM = 18;
const TILE_SIZE = 256;

export function tilePath({ plotId, sceneId, visualMode, z, x, y }) {
  return `ndvi/tiles/${plotId}/${sceneId}/${visualMode}/${z}/${x}/${y}.png`;
}

export function listTileZoomRange() {
  return { minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, tileSize: TILE_SIZE };
}

/**
 * Gera um tile 256x256 recortando a grade NDVI (implementação inicial: tile único = preview reduzido).
 */
export function generateTileFromRaster({ raster, visualMode, z, x, y }) {
  if (z < MIN_ZOOM || z > MAX_ZOOM) return null;
  const preview = generatePreviewFromRaster({ raster, visualMode });
  if (!preview?.buffer) return null;

  const full = PNG.sync.read(preview.buffer);
  const cols = 2 ** Math.max(0, z - MIN_ZOOM);
  const rows = cols;
  const tileW = Math.max(1, Math.floor(full.width / cols));
  const tileH = Math.max(1, Math.floor(full.height / rows));
  const ox = Math.min(x, cols - 1) * tileW;
  const oy = Math.min(y, rows - 1) * tileH;

  const tile = new PNG({ width: TILE_SIZE, height: TILE_SIZE });
  for (let ty = 0; ty < TILE_SIZE; ty += 1) {
    for (let tx = 0; tx < TILE_SIZE; tx += 1) {
      const sx = ox + Math.floor((tx / TILE_SIZE) * tileW);
      const sy = oy + Math.floor((ty / TILE_SIZE) * tileH);
      const si = (full.width * sy + sx) << 2;
      const ti = (TILE_SIZE * ty + tx) << 2;
      tile.data[ti] = full.data[si];
      tile.data[ti + 1] = full.data[si + 1];
      tile.data[ti + 2] = full.data[si + 2];
      tile.data[ti + 3] = full.data[si + 3] ?? 255;
    }
  }
  return PNG.sync.write(tile);
}
