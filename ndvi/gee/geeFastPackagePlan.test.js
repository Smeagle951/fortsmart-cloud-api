import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveFastPackagePlan } from './geeNdviEngine.js';

test('fastPreview NDRE + NDMI baixa somente os índices pedidos', () => {
  const plan = resolveFastPackagePlan({
    resolutionKind: 'fastPreview',
    modes: ['ndre', 'ndmi_water_stress'],
  });

  assert.equal(plan.minimalIndices, true);
  assert.equal(plan.fastContrastOnly, false);
  assert.equal(plan.fastNeedsContrastStats, false);
  assert.deepEqual(plan.fastIndexModes, ['ndvi', 'ndre', 'ndmi']);
});

test('fast NDVI permanece no caminho leve B04/B08', () => {
  const plan = resolveFastPackagePlan({
    resolutionKind: 'fast',
    modes: ['ndvi_contrast'],
  });

  assert.equal(plan.minimalIndices, true);
  assert.equal(plan.fastContrastOnly, true);
  assert.equal(plan.fastNeedsContrastStats, true);
  assert.deepEqual(plan.fastIndexModes, ['ndvi']);
});

test('pacote misto preserva percentis do contraste e índices avançados', () => {
  const plan = resolveFastPackagePlan({
    resolutionKind: 'fastPreview',
    modes: ['ndvi_contrast', 'ndre', 'ndmi_water_stress'],
  });

  assert.equal(plan.minimalIndices, true);
  assert.equal(plan.fastContrastOnly, false);
  assert.equal(plan.fastNeedsContrastStats, true);
  assert.deepEqual(plan.fastIndexModes, ['ndvi', 'ndre', 'ndmi']);
});

test('modo categórico mantém cálculo espectral completo', () => {
  const plan = resolveFastPackagePlan({
    resolutionKind: 'fastPreview',
    modes: ['bsi_soil'],
  });

  assert.equal(plan.minimalIndices, false);
  assert.deepEqual(plan.fastIndexModes, []);
});
