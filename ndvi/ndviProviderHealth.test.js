import test from 'node:test';
import assert from 'node:assert/strict';

import SoilSamplingNdviService from './soilSamplingNdvi.service.js';

test('GEE configurado como provider do pacote aparece pronto no health', () => {
  const keys = [
    'NDVI_PROVIDER',
    'NDVI_PACKAGE_PROVIDER',
    'GEE_ALLOW_USAGE',
    'GEE_ENABLED',
    'GEE_CLIENT_EMAIL',
    'GEE_PRIVATE_KEY',
  ];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.NDVI_PROVIDER = 'copernicus';
    process.env.NDVI_PACKAGE_PROVIDER = 'gee';
    process.env.GEE_ALLOW_USAGE = 'true';
    process.env.GEE_ENABLED = 'true';
    process.env.GEE_CLIENT_EMAIL = 'test@example.test';
    process.env.GEE_PRIVATE_KEY = 'test-key';

    const service = new SoilSamplingNdviService({
      geeClient: { isImplemented: () => true },
    });
    const health = service.getGeeHealth();
    assert.equal(health.readiness, 'ready');
    assert.equal(health.gee_engine_loaded, true);
    assert.equal(health.gee_primary, false);
    assert.equal(health.gee_package_ready, true);
    assert.equal(health.advanced_modes_available, true);
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});
