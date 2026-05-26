import { HttpError } from '../middleware/errorHandler.js';
const payloadKeys = {
    'monitoring-report': 'reports',
    planting: 'planting_records',
    'plant-stand': 'plant_stand_records',
    phenology: 'phenology_records',
    'geo-export': 'geo_exports',
};
function optRecordList(raw) {
    if (!Array.isArray(raw))
        return undefined;
    return raw.filter((item) => typeof item === 'object' && item !== null && !Array.isArray(item));
}
function requireStr(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new HttpError(`${field} is required`, 400);
    }
    return value.trim();
}
export function parseOperationalPushBody(raw, module) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new HttpError('Invalid JSON body', 400);
    }
    const o = raw;
    const payloadKey = payloadKeys[module];
    const records = o[payloadKey] ??
        (module === 'planting' ? o.plantings : undefined) ??
        (module === 'planting' ? o.planting_history : undefined) ??
        (module === 'monitoring-report' ? o.monitoring_reports : undefined) ??
        [];
    if (!Array.isArray(records)) {
        throw new HttpError(`${payloadKey} must be an array`, 400);
    }
    const base = {
        device_id: requireStr(o.device_id, 'device_id'),
        farm_local_id: requireStr(o.farm_local_id, 'farm_local_id'),
        farm_cloud_id: requireStr(o.farm_cloud_id, 'farm_cloud_id'),
        records: records.filter((item) => typeof item === 'object' && item !== null && !Array.isArray(item)),
    };
    if (module === 'planting') {
        base.stand_evaluations_all =
            optRecordList(o.stand_evaluations_all) ??
                optRecordList(o.plant_stand) ??
                optRecordList(o.stand_evaluations);
        base.cv_records_all =
            optRecordList(o.cv_records_all) ??
                optRecordList(o.plantability) ??
                optRecordList(o.cv_records);
        base.calibration_records_all = optRecordList(o.calibration_records_all);
        base.phenology_records_all = optRecordList(o.phenology_records_all);
        base.geo_exports_all =
            optRecordList(o.geo_exports_all) ??
                optRecordList(o.plot_geometries) ??
                optRecordList(o.exported_geojson);
    }
    return base;
}
//# sourceMappingURL=operationalSync.validator.js.map