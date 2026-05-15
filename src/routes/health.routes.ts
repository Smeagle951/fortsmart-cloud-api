import { Router } from 'express';
import { jsonOk } from '../utils/response.js';

/** Versão de capacidades — subir quando expor novas rotas (ex.: upload de imagens). */
export const API_CAPABILITIES_VERSION = 2;

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  jsonOk(res, {
    status: 'ok',
    service: 'fortsmart-cloud-api',
    capabilities_version: API_CAPABILITIES_VERSION,
    routes: {
      monitoring_report_push: 'POST /sync/monitoring-report/push',
      monitoring_report_image: 'POST /sync/monitoring-report/image',
      planting_push: 'POST /sync/planting/push',
      planting_image: 'POST /sync/planting/image',
    },
  });
});

/** Alias usado pelo app mobile em alguns builds. */
healthRouter.get('/ping', (_req, res) => {
  jsonOk(res, { status: 'ok', capabilities_version: API_CAPABILITIES_VERSION });
});
