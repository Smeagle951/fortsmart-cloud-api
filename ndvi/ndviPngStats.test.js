import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import {
  computeNdviStatsFromPreviewPng,
  isPlaceholderPreviewUrl,
} from './ndviPngStats.js';

describe('ndviPngStats', () => {
  it('detecta URL placeholder', () => {
    assert.equal(isPlaceholderPreviewUrl('https://dummyimage.com/512'), true);
    assert.equal(isPlaceholderPreviewUrl('https://cdn.example/a.png'), false);
  });

  it('calcula média a partir de pixels coloridos', () => {
    const png = new PNG({ width: 32, height: 32 });
    for (let y = 0; y < png.height; y += 1) {
      for (let x = 0; x < png.width; x += 1) {
        const i = (png.width * y + x) << 2;
        const low = x < png.width / 2;
        png.data[i] = low ? 191 : 26;
        png.data[i + 1] = low ? 13 : 140;
        png.data[i + 2] = low ? 13 : 38;
        png.data[i + 3] = 255;
      }
    }
    const buffer = PNG.sync.write(png);
    const stats = computeNdviStatsFromPreviewPng(buffer);
    assert.ok(stats);
    assert.ok(stats.ndvi_mean > 0.1);
    assert.ok(stats.ndvi_max > stats.ndvi_min);
  });
});
