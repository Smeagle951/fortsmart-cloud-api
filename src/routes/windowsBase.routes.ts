import { Router } from 'express';
import { HttpError } from '../middleware/errorHandler.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { loadWindowsBase } from '../services/windowsBase.service.js';
import { getPool } from '../db/pool.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { jsonOk } from '../utils/response.js';

export const windowsBaseRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

windowsBaseRouter.get(
  '/windows/base/:farmId',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const farmId = req.params.farmId?.trim() ?? '';
    if (!isUuid(farmId)) {
      throw new HttpError('farmId must be the cloud farm UUID', 400);
    }
    const auth = req.cloudAuth;
    if (!auth?.farmId) {
      throw new HttpError('API key not linked to a farm yet', 403);
    }
    if (auth.farmId.toLowerCase() !== farmId.toLowerCase()) {
      throw new HttpError('Forbidden', 403);
    }

    const pool = getPool();
    const data = await loadWindowsBase(pool, farmId);
    if (!data) {
      throw new HttpError('Farm not found', 404);
    }
    jsonOk(res, { data });
  }),
);
