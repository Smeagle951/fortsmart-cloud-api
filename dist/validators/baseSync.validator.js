import { HttpError } from '../middleware/errorHandler.js';
function requireStr(v, field) {
    if (typeof v !== 'string' || v.trim() === '') {
        throw new HttpError(`${field} is required`, 400);
    }
    return v.trim();
}
function optionalStr(v) {
    if (v == null)
        return null;
    const s = String(v).trim();
    return s === '' ? null : s;
}
function optionalNum(v) {
    if (v == null || v === '')
        return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}
function parseFarm(v) {
    if (typeof v !== 'object' || v === null) {
        throw new HttpError('farm must be an object', 400);
    }
    const o = v;
    const local_id = requireStr(o.local_id, 'farm.local_id');
    return {
        local_id,
        name: requireStr(o.name, 'farm.name'),
        owner_name: optionalStr(o.owner_name),
        city: optionalStr(o.city),
        state: optionalStr(o.state),
        total_area_ha: optionalNum(o.total_area_ha),
        updated_at: optionalStr(o.updated_at),
        deleted_at: optionalStr(o.deleted_at),
    };
}
function asArray(v, field) {
    if (v == null)
        return [];
    if (!Array.isArray(v)) {
        throw new HttpError(`${field} must be an array`, 400);
    }
    return v;
}
export function parseBasePushBody(raw) {
    if (typeof raw !== 'object' || raw === null) {
        throw new HttpError('Invalid JSON body', 400);
    }
    const o = raw;
    const device_id = requireStr(o.device_id, 'device_id');
    const farm_local_id = requireStr(o.farm_local_id, 'farm_local_id');
    const farm = parseFarm(o.farm);
    if (farm.local_id !== farm_local_id) {
        throw new HttpError('farm.local_id must equal farm_local_id', 400);
    }
    return {
        device_id,
        farm_local_id,
        farm,
        seasons: asArray(o.seasons, 'seasons'),
        crops: asArray(o.crops, 'crops'),
        plots: asArray(o.plots, 'plots'),
        subareas: asArray(o.subareas, 'subareas'),
    };
}
//# sourceMappingURL=baseSync.validator.js.map