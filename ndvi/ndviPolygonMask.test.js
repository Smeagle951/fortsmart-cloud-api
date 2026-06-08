import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInnerPixelBufferToValues,
  applyPolygonMaskToPngBuffer,
  maskValuesToPolygon,
  pointInRing,
} from './ndviPolygonMask.js';
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
    assert.ok(alphas.some((a) => a >= 180 && a <= 220), 'deve manter pixels dentro do talhão');
  });

  it('applyPolygonMaskToPngBuffer usa alpha 217 para 85%', () => {
    const png = new PNG({ width: 1, height: 1 });
    png.data[0] = 20;
    png.data[1] = 120;
    png.data[2] = 40;
    png.data[3] = 255;
    const masked = applyPolygonMaskToPngBuffer(PNG.sync.write(png), {
      bounds: { west: 0, south: 0, east: 1, north: 1 },
      polygon: {
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
      alphaInside: Math.round(0.85 * 255),
      log: false,
    });
    const out = PNG.sync.read(masked);
    assert.equal(out.data[3], 217);
  });

  it('maskValuesToPolygon exclui fora do polígono antes dos percentis', () => {
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
    const result = maskValuesToPolygon({
      values: [0.9, 0.1, 0.1, 0.1],
      width: 2,
      height: 2,
      bounds: { west: 0, south: 0, east: 1, north: 1 },
      polygon,
    });

    assert.equal(result.maskStats.outsidePolygonTransparent, true);
    assert.equal(result.maskStats.validPixels, 1);
    assert.equal(result.values.filter((value) => value != null).length, 1);
  });

  it('applyInnerPixelBufferToValues remove borda das estatísticas', () => {
    const values = [
      0.1, 0.1, 0.1, 0.1, 0.1,
      0.1, 0.8, 0.8, 0.8, 0.1,
      0.1, 0.8, 0.9, 0.8, 0.1,
      0.1, 0.8, 0.8, 0.8, 0.1,
      0.1, 0.1, 0.1, 0.1, 0.1,
    ];
    const result = applyInnerPixelBufferToValues({
      values,
      width: 5,
      height: 5,
      radiusPx: 1,
    });
    const kept = result.values.filter((value) => value != null);
    assert.equal(result.bufferStats.usedInnerBuffer, true);
    assert.equal(kept.length, 9);
    assert.equal(Math.min(...kept), 0.8);
  });
});
