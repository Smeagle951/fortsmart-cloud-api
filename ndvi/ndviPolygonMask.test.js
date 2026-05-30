import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPolygonMaskToPngBuffer, pointInRing } from './ndviPolygonMask.js';
import { PNG } from 'pngjs';

describe('ndviPolygonMask', () => {
  it('pointInRing detecta ponto dentro do quadrado', () => {
    const ring = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    assert.equal(pointInRing(0.5, 0.5, ring), true);
    assert.equal(pointInRing(2, 2, ring), false);
  });

  it('applyPolygonMaskToPngBuffer zera alpha fora do polígono', () => {
    const png = new PNG({ width: 2, height: 2 });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 255;
      png.data[i + 1] = 0;
      png.data[i + 2] = 0;
      png.data[i + 3] = 255;
    }
    const buffer = PNG.sync.write(png);
    const polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0.5, 0],
          [0.5, 0.5],
          [0, 0.5],
          [0, 0],
        ],
      ],
    };
    const masked = applyPolygonMaskToPngBuffer(buffer, {
      bounds: { west: 0, south: 0, east: 1, north: 1 },
      polygon,
    });
    const out = PNG.sync.read(masked);
    const alphas = [out.data[3], out.data[7], out.data[11], out.data[15]];
    const transparent = alphas.filter((a) => a === 0).length;
    assert.ok(transparent >= 1, 'deve mascarar ao menos um pixel fora do talhão');
    assert.ok(alphas.some((a) => a === 255), 'deve manter pixels dentro do talhão');
  });
});
