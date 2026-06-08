import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ndviToPreviewRgb,
  pickPreviewColormapMode,
} from './ndviColormap.js';

function rgbClose(a, b, tol = 0.05) {
  return (
    Math.abs(a[0] - b[0]) < tol &&
    Math.abs(a[1] - b[1]) < tol &&
    Math.abs(a[2] - b[2]) < tol
  );
}

describe('ndviColormap', () => {
  it('valores 0.1, 0.3, 0.5, 0.7, 0.9 geram cores diferentes (absoluto)', () => {
    const samples = [0.1, 0.3, 0.5, 0.7, 0.9];
    const colors = samples.map((v) => ndviToPreviewRgb(v, { mode: 'absolute' }));
    const unique = new Set(colors.map((c) => c?.join(',')));
    assert.equal(unique.size, samples.length);
  });

  it('0.1 e 0.3 não são verde escuro', () => {
    const low = ndviToPreviewRgb(0.1, { mode: 'absolute' });
    const mid = ndviToPreviewRgb(0.3, { mode: 'absolute' });
    const highGreen = ndviToPreviewRgb(0.9, { mode: 'absolute' });
    assert.ok(low);
    assert.ok(mid);
    assert.ok(highGreen);
    assert.ok(!rgbClose(low, highGreen));
    assert.ok(!rgbClose(mid, highGreen));
  });

  it('modo relativo diferencia 0.75 e 0.90 no mesmo talhão', () => {
    const vmin = 0.75;
    const vmax = 0.9;
    const cLow = ndviToPreviewRgb(0.76, { mode: 'relative', vmin, vmax });
    const cHigh = ndviToPreviewRgb(0.89, { mode: 'relative', vmin, vmax });
    assert.ok(cLow && cHigh);
    assert.ok(!rgbClose(cLow, cHigh));
  });

  it('auto escolhe relativo para talhão homogéneo alto', () => {
    assert.equal(
      pickPreviewColormapMode({ ndvi_min: 0.82, ndvi_max: 0.9, ndvi_mean: 0.87 }, 'auto'),
      'relative',
    );
  });

  it('talhão 0.87 homogéneo: absoluto tende a verde, relativo mostra contraste', () => {
    const v = 0.87;
    const abs = ndviToPreviewRgb(v, { mode: 'absolute' });
    const relLow = ndviToPreviewRgb(0.82, { mode: 'relative', vmin: 0.8, vmax: 0.92 });
    const relHigh = ndviToPreviewRgb(0.91, { mode: 'relative', vmin: 0.8, vmax: 0.92 });
    assert.ok(abs);
    assert.ok(relLow && relHigh);
    assert.ok(!rgbClose(relLow, relHigh));
  });

  it('contraste relativo usa p5/p95 e não escala fixa absoluta', () => {
    const absoluteLow = ndviToPreviewRgb(0.6, { mode: 'absolute' });
    const relativeLow = ndviToPreviewRgb(0.6, {
      mode: 'relative',
      vmin: 0.6,
      vmax: 0.82,
    });
    const relativeHigh = ndviToPreviewRgb(0.82, {
      mode: 'relative',
      vmin: 0.6,
      vmax: 0.82,
    });
    assert.ok(absoluteLow && relativeLow && relativeHigh);
    assert.ok(!rgbClose(absoluteLow, relativeLow));
    assert.ok(!rgbClose(relativeLow, relativeHigh));
    assert.ok(relativeLow[0] > relativeLow[1], 'p5 deve ficar vermelho/laranja');
    assert.ok(relativeHigh[1] > relativeHigh[0], 'p95 deve ficar verde');
  });
});
