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
  /** Planting: linhas órfãs / redundantes (mesmo contrato do app mobile). */
  stand_evaluations_all?: Record<string, unknown>[];
  cv_records_all?: Record<string, unknown>[];
  calibration_records_all?: Record<string, unknown>[];
  phenology_records_all?: Record<string, unknown>[];
  geo_exports_all?: Record<string, unknown>[];
};

const payloadKeys: Record<OperationalModule, string> = {
  'monitoring-report': 'reports',
  planting: 'planting_records',
  'plant-stand': 'plant_stand_records',
  phenology: 'phenology_records',
  'geo-export': 'geo_exports',
};

function optRecordList(raw: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter(
    (item): item is Record<string, unknown> =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  );
}

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
    (module === 'planting' ? o.plantings : undefined) ??
    (module === 'planting' ? o.planting_history : undefined) ??
    (module === 'monitoring-report' ? o.monitoring_reports : undefined) ??
    [];
  if (!Array.isArray(records)) {
    throw new HttpError(`${payloadKey} must be an array`, 400);
  }
  const base: OperationalPushBody = {
    device_id: requireStr(o.device_id, 'device_id'),
    farm_local_id: requireStr(o.farm_local_id, 'farm_local_id'),
    farm_cloud_id: requireStr(o.farm_cloud_id, 'farm_cloud_id'),
    records: records.filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && !Array.isArray(item),
    ),
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
