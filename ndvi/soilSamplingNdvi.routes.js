const express = require('express');

const SoilSamplingNdviRepository = require('./soilSamplingNdvi.repository');
const SoilSamplingNdviService = require('./soilSamplingNdvi.service');
const SoilSamplingNdviController = require('./soilSamplingNdvi.controller');
const CdseAuthClient = require('./cdseAuth.client');
const SentinelCatalogClient = require('./sentinelCatalog.client');
const SentinelProcessClient = require('./sentinelProcess.client');

function createSoilSamplingNdviRouter({ pool, publicBaseUrl = '' }) {
  const router = express.Router();

  const enableDevMock =
    process.env.NODE_ENV !== 'production' && process.env.NDVI_DEV_MOCK === 'true';

  const authClient = new CdseAuthClient();
  const catalogClient = new SentinelCatalogClient({
    authClient,
    enableDevMock,
  });
  const processClient = new SentinelProcessClient({
    authClient,
    enableDevMock,
    publicBaseUrl,
  });

  const repository = new SoilSamplingNdviRepository(pool);

  repository.ensureSchema().catch((error) => {
    console.error('❌ [NDVI] Falha ao preparar schema:', error.message);
  });

  const service = new SoilSamplingNdviService({
    repository,
    catalogClient,
    processClient,
  });

  const controller = new SoilSamplingNdviController(service, { authClient });

  router.get('/copernicus/test-token', controller.testCopernicusToken);

  router.post('/plots/:plotId/scenes/search', controller.searchScenes);
  router.get('/plots/:plotId/scenes', controller.getScenes);
  router.post('/plots/:plotId/generate', controller.generate);
  router.post('/campaigns/:campaignId/attach', controller.attach);
  router.get('/campaigns/:campaignId/active', controller.getActive);
  router.post('/campaigns/:campaignId/refresh', controller.refresh);

  return router;
}

module.exports = createSoilSamplingNdviRouter;
