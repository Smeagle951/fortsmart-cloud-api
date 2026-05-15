import { Router } from 'express';
import { jsonOk } from '../utils/response.js';

/** Versão de capacidades — subir quando expor novas rotas (ex.: upload de imagens). */
export const API_CAPABILITIES_VERSION = 2;

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  const railwaySha = process.env.RAILWAY_GIT_COMMIT_SHA;
  jsonOk(res, {
    status: 'ok',
    capabilities_version: API_CAPABILITIES_VERSION,
    ...(railwaySha ? { deploy_git_sha: railwaySha.slice(0, 7) } : {}),
    routes: {
      monitoring_report_image: 'POST /sync/monitoring-report/image',
      planting_image: 'POST /sync/planting/image',
      sync_diagnostics: 'GET /sync/diagnostics/:farmId',
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
