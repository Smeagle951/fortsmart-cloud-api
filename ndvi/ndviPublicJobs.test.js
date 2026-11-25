import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NdviImageryJobStore } from './ndviImageryJobs.js';

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
