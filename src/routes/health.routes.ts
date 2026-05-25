import { Router } from 'express';
import { getPool } from '../db/pool.js';
import { isObjectStorageConfigured } from '../services/objectStorage.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { jsonOk } from '../utils/response.js';

/** Versão de capacidades — subir quando expor novas rotas (ex.: upload de imagens). */
export const API_CAPABILITIES_VERSION = 3;

export const healthRouter = Router();

function formatUptime(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

async function probeDatabase(): Promise<'ok' | 'missing' | 'error'> {
  if (!process.env.DATABASE_URL?.trim()) return 'missing';
  try {
    await getPool().query('SELECT 1');
    return 'ok';
  } catch {
    return 'error';
  }
}

healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const database = await probeDatabase();
    jsonOk(res, {
      status: 'ok',
      service: 'fortsmart-cloud-api',
      environment: process.env.NODE_ENV || 'development',
      uptime: formatUptime(process.uptime()),
      capabilities_version: API_CAPABILITIES_VERSION,
      database,
      r2: isObjectStorageConfigured() ? 'ok' : 'missing',
      image_routes: true,
      windows_routes: true,
      sync_routes: true,
    });
  }),
);

/** Alias usado pelo app mobile em alguns builds. */
healthRouter.get('/ping', (_req, res) => {
  jsonOk(res, {
    status: 'ok',
    capabilities_version: API_CAPABILITIES_VERSION,
  });
});
