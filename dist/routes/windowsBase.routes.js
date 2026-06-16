import { Router } from 'express';
import { HttpError } from '../middleware/errorHandler.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { loadWindowsBase } from '../services/windowsBase.service.js';
import { getPool } from '../db/pool.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { jsonOk } from '../utils/response.js';
import { assertApiKeyCanAccessFarm } from '../lib/resourceAccessGuard.js';
export const windowsBaseRouter = Router();
windowsBaseRouter.get('/windows/base/:farmId', requireApiKey, asyncHandler(async (req, res) => {
    const farmId = assertApiKeyCanAccessFarm(req, req.params.farmId);
    const pool = getPool();
    const data = await loadWindowsBase(pool, farmId);
    if (!data) {
        throw new HttpError('Farm not found', 404);
    }
    jsonOk(res, { data });
}));
//# sourceMappingURL=windowsBase.routes.js.map