import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NdviImageryJobStore } from './ndviImageryJobs.js';
import SoilSamplingNdviService, { buildPackageInflightKey } from './soilSamplingNdvi.service.js';

test('spectral catalog needs no campaign and never reads saved farm layers', async () => {
  let queried = false;
  const service = new SoilSamplingNdviService({
    repository: {
      ensureSchema: () => assert.fail('public catalog must not access schema'),
      listByPlot: () => assert.fail('public catalog must not read private layers'),
    },
    catalogClient: { polygonToBbox: () => [0, 0, 1, 1], searchSentinelScenes: async () => { queried = true; return []; } },
  });
  const payload = { farmId: 'farm', plotId: 'plot', polygon: { type: 'Polygon', coordinates: [] },
    startDate: '2026-10-01', endDate: '2026-10-02', preferredProvider: 'copernicus' };
  assert.deepEqual(await service.searchScenes({ ...payload, includeSavedLayers: false }), []);
  assert.equal(queried, true);
  assert.notEqual(buildPackageInflightKey(payload), buildPackageInflightKey({ ...payload, persistGenerated: false }));
});

test('public processing cannot reuse or read authenticated jobs', () => {
  const store = new NdviImageryJobStore({ service: {}, schedule: () => {} });
  const payload = { farmId: 'farm', plotId: 'plot', sceneId: 'scene', modes: ['ndvi_contrast'] };
  const privateJob = store.create({ ...payload, ownerFarmId: 'farm' }).job;
  const publicJob = store.create({ ...payload, ownerFarmId: 'public-spectral' }).job;
  assert.notEqual(privateJob.jobId, publicJob.jobId);
  for (const method of ['get', 'result', 'retry']) {
    assert.equal(store[method](privateJob.jobId, { ownerFarmId: 'public-spectral' }), null);
    assert.equal(store[method](publicJob.jobId, { ownerFarmId: 'farm' }), null);
  }
  assert.ok(store.get(publicJob.jobId, { ownerFarmId: 'public-spectral' }));
});
