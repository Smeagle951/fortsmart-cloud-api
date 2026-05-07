import { HttpError } from '../middleware/errorHandler.js';

export type OperationalModule =
  | 'monitoring-report'
  | 'planting'
  | 'plant-stand'
  | 'phenology'
  | 'geo-export';

export type OperationalPushBody = {
  device_id: string;
  farm_local_id: string;
  farm_cloud_id: string;
  records: Record<string, unknown>[];
};

const payloadKeys: Record<OperationalModule, string> = {
  'monitoring-report': 'reports',
  planting: 'planting_records',
  'plant-stand': 'plant_stand_records',
  phenology: 'phenology_records',
  'geo-export': 'geo_exports',
};

function requireStr(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(`${field} is required`, 400);
  }
  return value.trim();
}

export function parseOperationalPushBody(
  raw: unknown,
  module: OperationalModule,
): OperationalPushBody {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HttpError('Invalid JSON body', 400);
  }
  const o = raw as Record<string, unknown>;
  const payloadKey = payloadKeys[module];
  const records =
    o[payloadKey] ??
    (module === 'monitoring-report' ? o.monitoring_reports : undefined) ??
    [];
  if (!Array.isArray(records)) {
    throw new HttpError(`${payloadKey} must be an array`, 400);
  }
  return {
    device_id: requireStr(o.device_id, 'device_id'),
    farm_local_id: requireStr(o.farm_local_id, 'farm_local_id'),
    farm_cloud_id: requireStr(o.farm_cloud_id, 'farm_cloud_id'),
    records: records.filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && !Array.isArray(item),
    ),
  };
}
