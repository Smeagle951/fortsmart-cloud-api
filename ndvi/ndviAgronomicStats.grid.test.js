import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';

import { computeAgronomicStatsFromPackedPngs } from './ndviAgronomicStats.js';

test('grade NDVI preserva a posição dos pixels transparentes do Process API', () => {
  const png = new PNG({ width: 8, height: 8 });
  for (let cell = 0; cell < 64; cell += 1) {
    const offset = cell * 4;
    png.data[offset] = cell === 63 ? 230 : 190;
    png.data[offset + 1] = 128;
    png.data[offset + 2] = 0;
    png.data[offset + 3] = cell === 0 || cell === 9 ? 0 : 255;
  }

  const stats = computeAgronomicStatsFromPackedPngs(PNG.sync.write(png));
  const grid = stats._ndvi_grid;
  assert.equal(grid.values.length, grid.width * grid.height);
  assert.equal(grid.values[0], null);
  assert.equal(grid.values[9], null);
  assert.ok(grid.values[1] > 0.48 && grid.values[1] < 0.5);
  assert.ok(grid.values[63] > grid.values[1]);
});
