import { authenticateBearer, touchLastUsed } from '../services/apiKey.service.js';
import { validateDeviceBinding } from '../services/pairing.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
export const requireApiKey = asyncHandler(async (req, _res, next) => {
    const row = await authenticateBearer(req.headers.authorization);
    const body = req.body;
    const queryDevice = typeof req.query.device_id === 'string' ? req.query.device_id : '';
    const bodyDevice = typeof body?.device_id === 'string' ? body.device_id : '';
    const headerDevice = String(req.headers['x-fortsmart-device-id'] ?? '').trim();
    const deviceId = headerDevice || bodyDevice || queryDevice;
    await validateDeviceBinding({
        apiKeyHash: row.key_hash,
        farmId: row.farm_id,
        deviceId,
    });
    req.cloudAuth = { apiKeyId: row.id, farmId: row.farm_id, apiKeyHash: row.key_hash, deviceId };
    await touchLastUsed(row.id);
    next();
});
//# sourceMappingURL=apiKeyAuth.js.map