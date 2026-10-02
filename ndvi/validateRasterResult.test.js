import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { validateRasterResult } from './validateRasterResult.js';

const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
const bounds = { west: 0, south: 0, east: 1, north: 1 };
const stats = { ndvi_mean: 0.4, ndvi_p5: 0.2, ndvi_p50: 0.4, ndvi_p95: 0.7 };

function image(width = 32, height = 32, opaque = () => true) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      png.data[offset] = 220;
      png.data[offset + 1] = 40;
      png.data[offset + 2] = 30;
      png.data[offset + 3] = opaque(x, y) ? 255 : 0;
    }
  }
  return PNG.sync.write(png);
}

test('raster completo pode ser FINAL_READY', () => {
  const result = validateRasterResult({ image: image(), polygon, bounds, stats, mode: 'ndvi_contrast', final: true });
  assert.equal(result.ok, true);
  assert.equal(result.layerStatus, 'FINAL_READY');
  assert.equal(result.validPixelCoveragePct, 100);
});

test('faixa isolada no topo não vira camada final', () => {
  const result = validateRasterResult({ image: image(32, 32, (_, y) => y < 3), polygon, bounds, stats, mode: 'ndvi_contrast', final: true });
  assert.equal(result.ok, false);
  assert.equal(result.layerStatus, 'INSUFFICIENT_COVERAGE');
  assert.ok(result.validPixelCoveragePct < 70);
});

test('faixa isolada também não vira prévia exibível', () => {
  const result = validateRasterResult({
    image: image(32, 32, (_, y) => y < 3), polygon, bounds,
    stats, mode: 'ndvi_contrast', final: false,
  });
  assert.equal(result.layerStatus, 'INSUFFICIENT_COVERAGE');
});

test('estatísticas incompatíveis com pixels válidos são rejeitadas', () => {
  const result = validateRasterResult({
    image: image(), polygon, bounds,
    stats: { ...stats, validPixelPercent: 5 },
    mode: 'ndvi_contrast', final: true,
  });
  assert.equal(result.code, 'INVALID_RADIOMETRY');
  assert.equal(result.reason, 'stats_coverage_disagrees_with_png');
});

test('bounds antigos são rejeitados', () => {
  const result = validateRasterResult({ image: image(), polygon, bounds: { ...bounds, north: 2 }, stats, mode: 'ndvi_absolute', final: true });
  assert.equal(result.code, 'INVALID_GEOMETRY');
});

test('pixels opacos fora do polígono são rejeitados', () => {
  const diamond = { type: 'Polygon', coordinates: [[[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5], [0.5, 0]]] };
  const result = validateRasterResult({ image: image(), polygon: diamond, bounds, stats, mode: 'ndvi_absolute', final: true });
  assert.equal(result.code, 'INVALID_GEOMETRY');
  assert.equal(result.reason, 'alpha_footprint_mismatch');
});
