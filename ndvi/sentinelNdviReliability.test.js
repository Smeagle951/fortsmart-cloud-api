import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNdviCacheKey,
  classifyRelativeNdviZone,
  homogeneityFromContrast,
  isValidSclPixel,
  normalizeReflectance,
  percentile,
  safeNdvi,
} from './sentinelNdviReliability.js';

test('safeNdvi calcula NDVI com reflectancia normalizada', () => {
  assert.equal(Number(safeNdvi(0.8, 0.2).toFixed(3)), 0.6);
  assert.equal(Number(safeNdvi(8000, 2000).toFixed(3)), 0.6);
});

test('normalizeReflectance preserva reflectancia e normaliza escala Sentinel', () => {
  assert.equal(normalizeReflectance(8000), 0.8);
  assert.equal(normalizeReflectance(0.8), 0.8);
  assert.ok(Number.isNaN(normalizeReflectance(Number.NaN)));
});

test('SCL aceita pixels agronomicos e rejeita nuvem sombra agua e gelo', () => {
  for (const scl of [4, 5, 7]) {
    assert.equal(isValidSclPixel(scl), true);
  }
  for (const scl of [3, 6, 8, 9, 10, 11]) {
    assert.equal(isValidSclPixel(scl), false);
  }
});

test('percentil p50 usa valores numericos ordenados', () => {
  assert.equal(percentile([0.1, 0.2, 0.3, 0.4, 0.5], 50), 0.3);
});

test('contraste e homogeneidade seguem contrato Sentinel confiavel', () => {
  const contrast = 0.88 - 0.85;
  assert.equal(Number(contrast.toFixed(2)), 0.03);
  assert.ok(homogeneityFromContrast(0.03) > 0.8);
  assert.ok(homogeneityFromContrast(0.17) < 0.3);
});

test('zonas relativas sao classificadas por percentis do NDVI real', () => {
  const p = { p10: 0.6, p30: 0.7, p70: 0.8, p90: 0.9 };
  assert.equal(classifyRelativeNdviZone(0.55, p), 'muito_abaixo');
  assert.equal(classifyRelativeNdviZone(0.65, p), 'abaixo');
  assert.equal(classifyRelativeNdviZone(0.75, p), 'padrao');
  assert.equal(classifyRelativeNdviZone(0.85, p), 'acima');
  assert.equal(classifyRelativeNdviZone(0.95, p), 'muito_acima');
});

test('cache key muda com versao do engine e hash do poligono', () => {
  const base = {
    fieldId: 'plot-1',
    sceneId: 'scene-1',
    mode: 'ndvi_contrast',
    opacity: 0.85,
    cloudMaskVersion: 'scl_v1',
    statsVersion: 'stats_v1',
    polygonHash: 'poly-a',
  };
  assert.notEqual(
    buildNdviCacheKey(base),
    buildNdviCacheKey({ ...base, ndviEngineVersion: 'sentinel_ndvi_reliable_v4' }),
  );
  assert.notEqual(
    buildNdviCacheKey(base),
    buildNdviCacheKey({ ...base, polygonHash: 'poly-b' }),
  );
  assert.notEqual(
    buildNdviCacheKey(base),
    buildNdviCacheKey({ ...base, statsVersion: 'stats_v2_inner_pixel_buffer' }),
  );
});
