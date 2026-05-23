import { Router } from 'express';
import {
  getObjectStorageMissingConfig,
  getObjectStoragePublicBaseUrl,
  isObjectStorageConfigured,
} from '../services/objectStorage.service.js';
import { jsonOk } from '../utils/response.js';

/** Versão de capacidades — subir quando expor novas rotas (ex.: upload de imagens). */
export const API_CAPABILITIES_VERSION = 3;

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  const railwaySha = process.env.RAILWAY_GIT_COMMIT_SHA;
  jsonOk(res, {
    status: 'ok',
    capabilities_version: API_CAPABILITIES_VERSION,
    object_storage_configured: isObjectStorageConfigured(),
    object_storage_missing: getObjectStorageMissingConfig(),
    object_storage_public_base: getObjectStoragePublicBaseUrl(),
    ...(railwaySha ? { deploy_git_sha: railwaySha.slice(0, 7) } : {}),
    routes: {
      monitoring_report_image: 'POST /sync/monitoring-report/image',
      planting_image: 'POST /sync/planting/image',
      sync_diagnostics: 'GET /sync/diagnostics/:farmId',
      pairing_create: 'POST /auth/pairing/create',
      pairing_consume: 'POST /auth/pairing/consume',
      ndvi_test_token: 'GET /api/soil-sampling/ndvi/copernicus/test-token',
      ndvi_scenes_search: 'POST /api/soil-sampling/ndvi/plots/:plotId/scenes/search',
      ndvi_generate: 'POST /api/soil-sampling/ndvi/plots/:plotId/generate',
      ndvi_attach: 'POST /api/soil-sampling/ndvi/campaigns/:campaignId/attach',
      ndvi_active: 'GET /api/soil-sampling/ndvi/campaigns/:campaignId/active',
      ndvi_refresh: 'POST /api/soil-sampling/ndvi/campaigns/:campaignId/refresh',
    },
  });
});

/** Alias usado pelo app mobile em alguns builds. */
healthRouter.get('/ping', (_req, res) => {
  jsonOk(res, {
    status: 'ok',
    capabilities_version: API_CAPABILITIES_VERSION,
  });
});
