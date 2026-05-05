import { authenticateBearer, touchLastUsed } from '../services/apiKey.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
export const requireApiKey = asyncHandler(async (req, _res, next) => {
    const row = await authenticateBearer(req.headers.authorization);
    req.cloudAuth = { apiKeyId: row.id, farmId: row.farm_id };
    await touchLastUsed(row.id);
    next();
});
//# sourceMappingURL=apiKeyAuth.js.map