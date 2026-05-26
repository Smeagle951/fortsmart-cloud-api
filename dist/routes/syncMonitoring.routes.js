import { Router } from 'express';
import { getPool } from '../db/pool.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { pushMonitoringSync } from '../services/monitoringSync.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { jsonOk } from '../utils/response.js';
export const syncMonitoringRouter = Router();
syncMonitoringRouter.post('/sync/monitoring/push', requireApiKey, asyncHandler(async (req, res) => {
    const auth = req.cloudAuth;
    if (!auth) {
        throw new HttpError('Unauthorized', 401);
    }
    const result = await pushMonitoringSync(getPool(), auth.apiKeyId, req.body);
    jsonOk(res, {
        payload_id: result.payload_id,
        synced_at: result.synced_at,
    });
}));
//# sourceMappingURL=syncMonitoring.routes.js.map