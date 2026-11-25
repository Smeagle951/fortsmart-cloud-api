import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { ndviAccess } from '../src/middleware/ndviAccess.js';

test('spectral routes work without pairing; private routes and invalid keys stay protected', async () => {
  const app = express();
  app.use(express.json());
  app.use('/ndvi', ndviAccess(
    (req, res, next) => {
      if (req.headers.authorization !== 'Bearer valid') { res.sendStatus(401); return; }
      next();
    },
    (req, res, next) => {
      if (req.body.farm_id !== 'allowed') { res.sendStatus(403); return; }
      next();
    },
  ));
  app.use('/ndvi', (req, res) => res.json({ campaign: req.body.campaign_id ?? null }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/ndvi`;
  const post = (path: string, body: object, authorization?: string) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { authorization } : {}) },
    body: JSON.stringify(body),
  });
  try {
    for (const path of ['/plots/p/scenes/search', '/plots/p/generate-package', '/imagery/jobs']) {
      const response = await post(path, { polygon: { type: 'Polygon' }, campaign_id: 'private' });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).campaign, null);
      assert.equal((await post(path, {})).status, 400);
      assert.equal((await post(path, { polygon: {} }, 'Bearer invalid')).status, 401);
    }
    for (const path of ['/plots/p/layers', '/campaigns/c/active', '/gee-test']) {
      assert.equal((await fetch(base + path)).status, 401);
    }
    assert.equal((await post('/campaigns/c/attach', {})).status, 401);
    assert.equal((await post('/campaigns/c/attach', { farm_id: 'other' }, 'Bearer valid')).status, 403);
    assert.equal((await post('/campaigns/c/attach', { farm_id: 'allowed' }, 'Bearer valid')).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
