import express from 'express';
import SoilSamplingNdviRepository from './soilSamplingNdvi.repository.js';
import SoilSamplingNdviService from './soilSamplingNdvi.service.js';
import SoilSamplingNdviController from './soilSamplingNdvi.controller.js';
import CdseAuthClient from './cdseAuth.client.js';
import SentinelCatalogClient from './sentinelCatalog.client.js';
import SentinelProcessClient from './sentinelProcess.client.js';
import { GeeNdviProviderClient } from './NdviProviderClient.js';
import { getNdviProviderStatus } from './ndviEnv.js';

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

  // Copernicus-first: GEE fica dormente (engine=null → isImplemented()=false)
  // para evitar custo acidental. Só carregamos o engine real com opt-in
  // explícito em ndviEnv: NDVI_PROVIDER=gee + GEE_ALLOW_USAGE=true.
  const geeClient = new GeeNdviProviderClient({ engine: null });

  const service = new SoilSamplingNdviService({
    repository,
    catalogClient,
    processClient,
    authClient,
    geeClient,
  });

  const geeReady = (async () => {
    const status = getNdviProviderStatus();
    if (!status.gee_primary) return;
    try {
      const mod = await import('./gee/geeNdviEngine.js');
      geeClient.engine = await mod.createGeeNdviEngine({ publicBaseUrl });
      console.log('✅ [NDVI] Google Earth Engine ativo por opt-in explícito');
    } catch (error) {
      console.warn(
        `⚠️ [NDVI] GEE solicitado mas engine indisponível — usando Copernicus: ${error?.message || error}`,
      );
    }
  })();

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
    await Promise.all([schemaReady, geeReady]);
    req.ndviSchemaAvailable = schemaAvailable;
    next();
  });

  router.get('/health', controller.getStatus);
  router.get('/gee-health', controller.getGeeHealth);
  router.get('/gee-test', controller.getGeeTest);
  router.get('/copernicus/test-token', controller.testCopernicusToken);
  router.get('/status', controller.getStatus);

  router.post('/plots/:plotId/scenes/search', controller.searchScenes);
  router.get('/plots/:plotId/scenes', controller.getScenes);
  router.get('/plots/:plotId/layers', controller.listLayers);
  router.post('/plots/:plotId/generate', controller.generate);
  router.post('/plots/:plotId/generate-package', controller.generatePackage);
  router.post('/generate-package', controller.generatePackage);
  router.post('/ndvi/generate-package', controller.generatePackage);
  router.post('/campaigns/:campaignId/attach', controller.attach);
  router.get('/campaigns/:campaignId/active', controller.getActive);
  router.post('/campaigns/:campaignId/refresh', controller.refresh);

  return router;
}

export default createSoilSamplingNdviRouter;
