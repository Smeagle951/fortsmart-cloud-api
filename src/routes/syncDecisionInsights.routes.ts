import { Router } from 'express';
import { getPool } from '../db/pool.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { jsonOk } from '../utils/response.js';
import { pushDecisionInsightsSync } from '../services/decisionInsightsSync.service.js';

export const syncDecisionInsightsRouter = Router();

syncDecisionInsightsRouter.post(
  '/sync/decision-insights/push',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const auth = req.cloudAuth;
    if (!auth) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }
    const result = await pushDecisionInsightsSync(getPool(), auth.apiKeyId, req.body);
    jsonOk(res, {
      received: result.received,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      synced_at: result.synced_at,
      farm_cloud_id: result.farm_cloud_id,
    });
  }),
);
