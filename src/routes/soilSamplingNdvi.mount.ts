import type { Router } from 'express';
import createNdviRouter from '../../ndvi/soilSamplingNdvi.routes.js';
import { getPool } from '../db/pool.js';

/**
 * Monta rotas NDVI (ESM) na API FortSmart Cloud.
 * Duas bases: /api/soil-sampling/ndvi e /soil-sampling/ndvi (compat Flutter).
 */
export function createSoilSamplingNdviRouter(): Router {
  return createNdviRouter({
    pool: getPool(),
    publicBaseUrl: process.env.NDVI_PUBLIC_BASE_URL || '',
  });
}
