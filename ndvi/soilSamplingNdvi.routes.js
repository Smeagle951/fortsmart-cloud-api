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

  // Seam GEE-primary: começa dormente (engine=null → isImplemented()=false),
  // então o serviço usa Copernicus normalmente. Quando GEE está habilitado e
  // configurado, carregamos o engine real dinamicamente (precisa portar
  // ./gee/geeNdviEngine.js e instalar @google/earthengine). Se o engine não
  // estiver disponível, mantém-se o fallback Copernicus sem quebrar produção.
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
      console.log('✅ [NDVI] Google Earth Engine ativo como provider principal');
    } catch (error) {
      console.warn(
        `⚠️ [NDVI] GEE habilitado mas engine indisponível — fallback Copernicus: ${error?.message || error}`,
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
