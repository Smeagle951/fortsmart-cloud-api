import express from 'express';
import SoilSamplingNdviRepository from './soilSamplingNdvi.repository.js';
import SoilSamplingNdviService from './soilSamplingNdvi.service.js';
import SoilSamplingNdviController from './soilSamplingNdvi.controller.js';
import CdseAuthClient from './cdseAuth.client.js';
import SentinelCatalogClient from './sentinelCatalog.client.js';
import SentinelProcessClient from './sentinelProcess.client.js';

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

  const service = new SoilSamplingNdviService({
    repository,
    catalogClient,
    processClient,
    authClient,
  });

  const controller = new SoilSamplingNdviController(service, { authClient });

  let schemaAvailable = false;
  const schemaReady = repository
    .ensureSchema()
    .then(() => {
      schemaAvailable = true;
      console.log('✅ [NDVI] schema soil_ndvi_layers pronto');
    })
    .catch((error) => {
      schemaAvailable = false;
      console.error(
        `❌ [NDVI] Falha ao preparar schema (modo degradado): ${error.message}`,
      );
    });

  router.use(async (req, res, next) => {
    await schemaReady;
    req.ndviSchemaAvailable = schemaAvailable;
    next();
  });

  router.get('/health', controller.getStatus);
  router.get('/copernicus/test-token', controller.testCopernicusToken);
  router.get('/status', controller.getStatus);

  router.post('/plots/:plotId/scenes/search', controller.searchScenes);
  router.get('/plots/:plotId/scenes', controller.getScenes);
  router.get('/plots/:plotId/layers', controller.listLayers);
  router.post('/plots/:plotId/generate', controller.generate);
  router.post('/campaigns/:campaignId/attach', controller.attach);
  router.get('/campaigns/:campaignId/active', controller.getActive);
  router.post('/campaigns/:campaignId/refresh', controller.refresh);

  return router;
}

export default createSoilSamplingNdviRouter;
