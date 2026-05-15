import { Router } from 'express';
import { HttpError } from '../middleware/errorHandler.js';
import { authenticateBearer, DEFAULT_MODULES, regenerateRawApiKeyForFarm, touchLastUsed } from '../services/apiKey.service.js';
import { getPool } from '../db/pool.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { jsonOk } from '../utils/response.js';

export const authRouter = Router();

const NOT_LINKED_MSG =
  'API Key válida. Primeira sincronização ainda não vinculou uma fazenda.';

authRouter.post(
  '/auth/api-key/regenerate',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const apiKey = typeof body?.api_key === 'string' ? body.api_key.trim() : '';
    const farmId =
      typeof body?.farm_cloud_id === 'string' && body.farm_cloud_id.trim()
        ? body.farm_cloud_id.trim()
        : typeof body?.farm_id === 'string'
          ? body.farm_id.trim()
          : '';
    if (!apiKey) throw new HttpError('api_key is required', 400);
    if (!farmId) throw new HttpError('farm_id or farm_cloud_id is required', 400);

    const result = await regenerateRawApiKeyForFarm({
      rawKey: apiKey,
      farmIdOrCloudId: farmId,
      name: typeof body?.name === 'string' ? body.name : undefined,
    });

    jsonOk(res, {
      message: result.farm_id
        ? 'API Key registrada e vinculada à fazenda.'
        : 'API Key registrada. Ela será vinculada no primeiro push da fazenda.',
      key_id: result.key_id,
      farm_id: result.farm_id,
      key_prefix: result.key_prefix,
      created_at: result.created_at,
    });
  }),
);

authRouter.post(
  '/auth/api-key/validate',
  asyncHandler(async (req, res) => {
    const row = await authenticateBearer(req.headers.authorization);
    await touchLastUsed(row.id);

    const body = req.body as Record<string, unknown> | undefined;
    const farmIdParam =
      typeof body?.farm_id === 'string'
        ? body.farm_id.trim()
        : body?.farm_id != null
          ? String(body.farm_id).trim()
          : '';
    if (!farmIdParam) {
      throw new HttpError('farm_id is required', 400);
    }

    const modules = [...DEFAULT_MODULES];

    if (row.farm_id === null) {
      jsonOk(res, {
        connected: false,
        message: NOT_LINKED_MSG,
        modules,
      });
      return;
    }

    const pool = getPool();
    const { rows } = await pool.query<{
      id: string;
      local_id: string;
      name: string;
    }>(
      `SELECT id, local_id, name FROM farms
       WHERE (id::text = $1 OR local_id = $1) AND deleted_at IS NULL
       LIMIT 1`,
      [farmIdParam],
    );
    const farm = rows[0];
    if (!farm) {
      throw new HttpError('Farm not found', 404);
    }
    if (farm.id !== row.farm_id) {
      throw new HttpError('farm_id does not match this API key', 403);
    }

    jsonOk(res, {
      connected: true,
      farm: {
        id: farm.id,
        name: farm.name,
        local_id: farm.local_id,
      },
      modules,
    });
  }),
);
