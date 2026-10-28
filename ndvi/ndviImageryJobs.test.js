import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IMAGERY_JOB_STATES,
  NdviImageryJobStore,
  imageryJobIdempotencyKey,
  isRecoverableProviderFailure,
} from './ndviImageryJobs.js';

const payload = {
  farmId: 'farm-1',
  plotId: 'plot-1',
  campaignId: 'campaign-1',
  sceneId: 'scene-1',
  polygon: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  imageDate: '2026-10-19',
  modes: ['ndvi_contrast'],
  preferredProvider: 'gee',
};

test('job é idempotente e só fica READY com artefatos obrigatórios', async () => {
  const scheduled = [];
  const service = {
    async generateLayerPackage() {
      return {
        provider: 'google_earth_engine',
        layersByMode: {
          ndvi_contrast: {
            id: 'layer-1',
            preview_url: 'https://example.test/ndvi.png',
            raster_url: 'https://example.test/ndvi.tif',
            ndvi_mean: 0.62,
          },
        },
        statusesByMode: { ndvi_contrast: { status: 'ready' } },
      };
    },
  };
  const store = new NdviImageryJobStore({
    service,
    schedule: (callback) => scheduled.push(callback),
  });

  const first = store.create(payload);
  const duplicate = store.create(payload);
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.job.jobId, first.job.jobId);
  assert.equal(first.job.status, IMAGERY_JOB_STATES.QUEUED);

  await scheduled.shift()();
  const ready = store.result(first.job.jobId);
  assert.equal(ready.status, IMAGERY_JOB_STATES.READY);
  assert.equal(ready.providerUsed, 'google_earth_engine');
  assert.equal(ready.artifacts.ndvi_contrast.numericRaster, true);
  assert.equal(ready.artifacts.ndvi_contrast.visualization, true);
  assert.equal(ready.artifacts.ndvi_contrast.statistics, true);
  assert.ok(ready.result);
});

test('preview sem estatísticas fica READY para inspeção do mapa', async () => {
  const scheduled = [];
  const store = new NdviImageryJobStore({
    service: {
      async generateLayerPackage() {
        return {
          layersByMode: {
            ndvi_contrast: {
              id: 'layer-preview',
              preview_url: 'https://example.test/preview.png',
            },
          },
          statusesByMode: { ndvi_contrast: { status: 'ready' } },
        };
      },
    },
    schedule: (callback) => scheduled.push(callback),
  });
  const created = store.create(payload);
  await scheduled.shift()();
  const ready = store.get(created.job.jobId);
  assert.equal(ready.status, IMAGERY_JOB_STATES.READY);
  assert.equal(ready.previewReady, true);
  assert.equal(ready.mapReady, true);
  assert.equal(ready.analyticsReady, false);
});

test('job falha quando pacote não retorna visualização/estatísticas', async () => {
  const scheduled = [];
  const store = new NdviImageryJobStore({
    service: {
      async generateLayerPackage() {
        return {
          layersByMode: { ndvi_contrast: { id: 'layer-without-assets' } },
          statusesByMode: {},
        };
      },
    },
    schedule: (callback) => scheduled.push(callback),
  });
  const created = store.create(payload);
  await scheduled.shift()();
  const failed = store.get(created.job.jobId);
  assert.equal(failed.status, IMAGERY_JOB_STATES.FAILED);
  assert.equal(failed.error.code, 'required_artifact_missing');
});

test('chave muda com configuração científica e credencial não permite fallback', () => {
  assert.notEqual(
    imageryJobIdempotencyKey(payload),
    imageryJobIdempotencyKey({ ...payload, algorithmVersion: 'v2' }),
  );
  assert.equal(
    isRecoverableProviderFailure({ code: 'gee_not_configured', status: 503 }),
    false,
  );
  assert.equal(
    isRecoverableProviderFailure({ code: 'provider_timeout', status: 503 }),
    true,
  );
  assert.equal(
    isRecoverableProviderFailure({
      code: 'gee_operation_failed',
      status: 500,
      message: 'Service account permission denied',
    }),
    false,
  );
});

test('job fica isolado por fazenda autorizada', () => {
  const store = new NdviImageryJobStore({
    service: { generateLayerPackage: async () => ({}) },
    schedule: () => {},
  });
  const created = store.create({ ...payload, ownerFarmId: 'farm-1' });
  assert.ok(store.get(created.job.jobId, { ownerFarmId: 'farm-1' }));
  assert.equal(store.get(created.job.jobId, { ownerFarmId: 'farm-2' }), null);
});

test('retry reinicia somente falha recuperável', async () => {
  const scheduled = [];
  let calls = 0;
  const store = new NdviImageryJobStore({
    service: {
      async generateLayerPackage() {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error('provider timeout'), {
            code: 'provider_timeout',
            status: 503,
          });
        }
        return {
          provider: 'google_earth_engine',
          layersByMode: {
            ndvi_contrast: {
              id: 'layer-retried',
              preview_url: 'https://example.test/ndvi.png',
              ndvi_mean: 0.61,
            },
          },
          statusesByMode: { ndvi_contrast: { status: 'ready' } },
        };
      },
    },
    schedule: (callback) => scheduled.push(callback),
  });
  const created = store.create(payload);
  await scheduled.shift()();
  assert.equal(store.get(created.job.jobId).error.retryable, true);

  const retried = store.retry(created.job.jobId);
  assert.equal(retried.status, IMAGERY_JOB_STATES.QUEUED);
  await scheduled.shift()();
  assert.equal(store.get(created.job.jobId).status, IMAGERY_JOB_STATES.READY);
});

test('camada final sem georreferência canônica não fica READY', async () => {
  const scheduled = [];
  const store = new NdviImageryJobStore({
    service: {
      async generateLayerPackage() {
        return {
          layersByMode: {
            ndvi_contrast: {
              id: 'layer-final',
              preview_url: 'https://example.test/ndvi.png',
              raster_url: 'https://example.test/ndvi.tif',
              agronomic_stats: { ndvi_mean: 0.6 },
            },
          },
          statusesByMode: { ndvi_contrast: { status: 'ready' } },
        };
      },
    },
    schedule: (callback) => scheduled.push(callback),
  });
  const created = store.create({ ...payload, resolutionKind: 'final' });
  await scheduled.shift()();
  assert.equal(store.get(created.job.jobId).status, IMAGERY_JOB_STATES.FAILED);
  assert.equal(store.get(created.job.jobId).error.code, 'required_artifact_missing');
});
