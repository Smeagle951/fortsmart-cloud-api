import type { Router } from 'express';
import type { Pool } from 'pg';

declare function createSoilSamplingNdviRouter(opts: {
  pool: Pool;
  publicBaseUrl?: string;
}): Router;

export default createSoilSamplingNdviRouter;
