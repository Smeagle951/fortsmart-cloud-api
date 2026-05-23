import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Router } from 'express';
import { getPool } from '../db/pool.js';

const require = createRequire(import.meta.url);
const ndviRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../ndvi',
);

/**
 * Monta rotas NDVI (CommonJS) na API FortSmart Cloud.
 * Duas bases: /api/soil-sampling/ndvi e /soil-sampling/ndvi (compat Flutter).
 */
export function createSoilSamplingNdviRouter(): Router {
  const createRouter = require(
    path.join(ndviRoot, 'soilSamplingNdvi.routes.js'),
  ) as (opts: {
    pool: ReturnType<typeof getPool>;
    publicBaseUrl?: string;
  }) => Router;

  return createRouter({
    pool: getPool(),
    publicBaseUrl: process.env.NDVI_PUBLIC_BASE_URL || '',
  });
}
