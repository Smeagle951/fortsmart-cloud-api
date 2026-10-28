import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGeeTileUrl,
  packageThumbSizes,
  resolveFastPackagePlan,
  visualizationFor,
} from './geeNdviEngine.js';

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

test('visualização GEE com paleta nunca combina gamma', () => {
  for (const mode of ['ndvi_contrast', 'ndvi_absolute', 'ndre', 'msavi']) {
    const params = visualizationFor({
      mode,
      stats: {
        ndvi_p2: 0.2,
        ndvi_p5: 0.3,
        ndvi_p50: 0.55,
        ndvi_p95: 0.75,
        ndvi_p98: 0.8,
      },
    });
    assert.ok(Array.isArray(params.palette), `${mode} deve manter paleta`);
    assert.equal(params.gamma, undefined, `${mode} não pode enviar gamma com paleta`);
  }
});

test('preview mobile GEE fica entre 384 e 512 pixels', () => {
  assert.deepEqual(packageThumbSizes(154, 1, 'preview'), [512]);
  assert.deepEqual(packageThumbSizes(154, 3, 'preview'), [384]);
  assert.deepEqual(packageThumbSizes(154, 1, 'fastPreview'), [384]);
});

test('sessão GEE publica template XYZ retornado pelo SDK', async () => {
  const expected =
    'https://earthengine.googleapis.com/v1/projects/fortsmart/maps/map-id/tiles/{z}/{x}/{y}';
  const image = {
    getMapId(_params, callback) {
      callback({ urlFormat: expected }, null);
    },
  };
  assert.equal(await createGeeTileUrl(image), expected);
});

test('sessão GEE rejeita URL sem placeholders XYZ', async () => {
  const image = {
    getMapId(_params, callback) {
      callback({ urlFormat: 'https://example.test/tile.png' }, null);
    },
  };
  await assert.rejects(
    createGeeTileUrl(image),
    (error) => error.code === 'gee_map_session_invalid',
  );
});
