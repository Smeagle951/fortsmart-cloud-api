import { Router } from 'express';
import { getPool } from '../db/pool.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { pushOperationalSync } from '../services/operationalSync.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { jsonOk } from '../utils/response.js';
import { parseOperationalPushBody, } from '../validators/operationalSync.validator.js';
import { monitoringMediaRouter } from './monitoringMedia.routes.js';
import { plantingMediaRouter } from './plantingMedia.routes.js';
export const syncOperationalRouter = Router();
function registerPush(path, module) {
    syncOperationalRouter.post(path, requireApiKey, asyncHandler(async (req, res) => {
        const auth = req.cloudAuth;
        if (!auth)
            throw new HttpError('Unauthorized', 401);
        const body = parseOperationalPushBody(req.body, module);
        const result = await pushOperationalSync(getPool(), auth.apiKeyId, module, body);
        jsonOk(res, {
            farm_cloud_id: result.farm_cloud_id,
            mapping: result.mapping,
            failed: result.failed,
            synced_at: result.synced_at,
        });
    }));
}
registerPush('/sync/monitoring-report/push', 'monitoring-report');
registerPush('/sync/planting/push', 'planting');
registerPush('/sync/plant-stand/push', 'plant-stand');
registerPush('/sync/phenology/push', 'phenology');
registerPush('/sync/geo-export/push', 'geo-export');
// Upload multipart de imagens (monitoramento / plantio) no mesmo router que os `push`,
// para instâncias que montam apenas `syncOperationalRouter` sem `monitoringMediaRouter`.
syncOperationalRouter.use(monitoringMediaRouter);
syncOperationalRouter.use(plantingMediaRouter);
//# sourceMappingURL=syncOperational.routes.js.map