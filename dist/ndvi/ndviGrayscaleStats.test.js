import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { computeNdviStatsFromFloatEncodedPng } from './ndviGrayscaleStats.js';

describe('ndviGrayscaleStats', () => {
  it('decodifica NDVI a partir de canal R = (ndvi+1)/2', () => {
    const png = new PNG({ width: 32, height: 32 });
    const targetV = (0.42 + 1) / 2;
    const rByte = Math.round(targetV * 255);
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const i = (png.width * y + x) << 2;
        png.data[i] = rByte;
        png.data[i + 1] = rByte;
        png.data[i + 2] = rByte;
        png.data[i + 3] = 255;
      }
    }
    const buffer = PNG.sync.write(png);
    const stats = computeNdviStatsFromFloatEncodedPng(buffer);
    assert.ok(stats);
    assert.ok(Math.abs(stats.ndvi_mean - 0.42) < 0.06);
    assert.ok(stats.ndvi_min <= stats.ndvi_mean);
    assert.ok(stats.ndvi_mean <= stats.ndvi_max);
  });
});
