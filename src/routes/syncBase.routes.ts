import { Router } from 'express';
import { getPool } from '../db/pool.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { pushBaseSync } from '../services/baseSync.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { jsonOk } from '../utils/response.js';
import { parseBasePushBody } from '../validators/baseSync.validator.js';

export const syncBaseRouter = Router();

syncBaseRouter.post(
  '/sync/base/push',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const dryRun = req.query.dryRun === 'true' || process.env.DRY_RUN === '1';
    const body = parseBasePushBody(req.body);
    const auth = req.cloudAuth;
    if (!auth) {
      throw new HttpError('Unauthorized', 401);
    }
    const pool = getPool();
    const result = await pushBaseSync(pool, auth.apiKeyId, body, dryRun);
    jsonOk(res, {
      farm_cloud_id: result.farm_cloud_id,
      mapping: result.mapping,
      synced_at: result.synced_at,
    });
  }),
);
