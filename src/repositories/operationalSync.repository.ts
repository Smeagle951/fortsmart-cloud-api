import type { PoolClient } from 'pg';
import type { OperationalModule } from '../validators/operationalSync.validator.js';

export type ItemFailure = {
  local_id: string | null;
  error: string;
};

export type OperationalUpsertResult = {
  mapping: Record<string, string>;
  failed: ItemFailure[];
};

type ModuleSpec = {
  module: OperationalModule;
  table: string;
  entity: string;
  buildValues(record: Record<string, unknown>, farmId: string): Record<string, unknown>;
};

function str(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value == null) return null;
  const out = String(value).trim();
  return out === '' ? null : out;
}

function uuid(record: Record<string, unknown>, key: string): string | null {
  const value = str(record, key);
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : null;
}

function num(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value == null || value === '') return null;
  const out = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(out) ? out : null;
}

function json(value: unknown, fallback: unknown): unknown {
  return value == null ? fallback : value;
}

function dateOnly(value: unknown): string | null {
  if (value == null || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function iso(value: unknown): string | null {
  if (value == null || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function localId(record: Record<string, unknown>): string {
  return str(record, 'local_id') ?? '';
}

function baseLinked(record: Record<string, unknown>, farmId: string): Record<string, unknown> {
  return {
    local_id: localId(record),
    farm_id: farmId,
    plot_local_id: str(record, 'plot_local_id'),
    plot_cloud_id: uuid(record, 'plot_cloud_id'),
    subarea_local_id: str(record, 'subarea_local_id'),
    subarea_cloud_id: uuid(record, 'subarea_cloud_id'),
    deleted_at: iso(record.deleted_at),
    raw_payload: record,
  };
}

const specs: Record<OperationalModule, ModuleSpec> = {
  'monitoring-report': {
    module: 'monitoring-report',
    table: 'monitoring_reports',
    entity: 'monitoring_report',
    buildValues(record, farmId) {
      return {
        ...baseLinked(record, farmId),
        season_local_id: str(record, 'season_local_id'),
        crop_local_id: str(record, 'crop_local_id'),
        report_date: iso(record.date ?? record.evaluation_date),
        phenological_stage: str(record, 'phenological_stage'),
        technician_name: str(record, 'technician_name'),
        observations: str(record, 'observations') ?? str(record, 'notes'),
        status: str(record, 'status'),
      };
    },
  },
  planting: {
    module: 'planting',
    table: 'planting_records',
    entity: 'planting_record',
    buildValues(record, farmId) {
      return {
        ...baseLinked(record, farmId),
        season_local_id: str(record, 'season_local_id'),
        season_cloud_id: uuid(record, 'season_cloud_id'),
        crop_local_id: str(record, 'crop_local_id'),
        crop_cloud_id: uuid(record, 'crop_cloud_id'),
        variety_name: str(record, 'variety_name') ?? str(record, 'material') ?? str(record, 'hibrido'),
        planting_date: dateOnly(record.planting_date ?? record.date),
        spacing_m: num(record, 'spacing_m'),
        planned_population: num(record, 'planned_population'),
        real_population: num(record, 'real_population'),
        area_ha: num(record, 'area_ha'),
        notes: str(record, 'notes') ?? str(record, 'observations'),
        status: str(record, 'status'),
      };
    },
  },
  'plant-stand': {
    module: 'plant-stand',
    table: 'plant_stand_records',
    entity: 'plant_stand_record',
    buildValues(record, farmId) {
      return {
        ...baseLinked(record, farmId),
        evaluation_date: iso(record.evaluation_date ?? record.date),
        plants_counted: num(record, 'plants_counted'),
        meters_evaluated: num(record, 'meters_evaluated'),
        estimated_population: num(record, 'estimated_population'),
        failures_count: num(record, 'failures_count'),
        latitude: num(record, 'latitude'),
        longitude: num(record, 'longitude'),
        photos: json(record.photos, []),
        notes: str(record, 'notes') ?? str(record, 'observations'),
      };
    },
  },
  phenology: {
    module: 'phenology',
    table: 'phenology_records',
    entity: 'phenology_record',
    buildValues(record, farmId) {
      return {
        ...baseLinked(record, farmId),
        crop_local_id: str(record, 'crop_local_id'),
        crop_cloud_id: uuid(record, 'crop_cloud_id'),
        evaluation_date: iso(record.evaluation_date ?? record.date),
        stage: str(record, 'stage') ?? str(record, 'phenological_stage'),
        description: str(record, 'description'),
        latitude: num(record, 'latitude'),
        longitude: num(record, 'longitude'),
        photos: json(record.photos, []),
        notes: str(record, 'notes') ?? str(record, 'observations'),
      };
    },
  },
  'geo-export': {
    module: 'geo-export',
    table: 'geo_exports',
    entity: 'geo_export',
    buildValues(record, farmId) {
      return {
        ...baseLinked(record, farmId),
        type: str(record, 'type') ?? 'geojson',
        file_name: str(record, 'file_name') ?? str(record, 'name'),
        latitude: num(record, 'latitude'),
        longitude: num(record, 'longitude'),
        geojson: record.geojson ?? null,
        kml_text: str(record, 'kml_text'),
        notes: str(record, 'notes') ?? str(record, 'observations'),
      };
    },
  },
};

export function getOperationalSpec(module: OperationalModule): ModuleSpec {
  return specs[module];
}

export async function logSync(
  client: PoolClient,
  farmId: string | null,
  opts: {
    module: string;
    entity?: string;
    local_id?: string | null;
    cloud_id?: string | null;
    action?: string;
    status: string;
    error_message?: string;
    device_id?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO sync_logs (farm_id, module, entity, local_id, cloud_id, action, status, error_message, device_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      farmId,
      opts.module,
      opts.entity ?? null,
      opts.local_id ?? null,
      opts.cloud_id ?? null,
      opts.action ?? null,
      opts.status,
      opts.error_message ?? null,
      opts.device_id ?? null,
    ],
  );
}

export async function upsertOperationalRecords(
  client: PoolClient,
  module: OperationalModule,
  farmId: string,
  records: Record<string, unknown>[],
  deviceId: string,
): Promise<OperationalUpsertResult> {
  const spec = getOperationalSpec(module);
  const mapping: Record<string, string> = {};
  const failed: ItemFailure[] = [];

  for (const record of records) {
    const lid = localId(record);
    if (!lid) {
      failed.push({ local_id: null, error: 'missing local_id' });
      await logSync(client, farmId, {
        module,
        entity: spec.entity,
        status: 'error',
        error_message: 'missing local_id',
        device_id: deviceId,
      });
      continue;
    }

    try {
      const values = spec.buildValues(record, farmId);
      const keys = Object.keys(values);
      const columns = keys.join(', ');
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const updateColumns = keys
        .filter((key) => key !== 'id' && key !== 'farm_id' && key !== 'local_id' && key !== 'created_at')
        .map((key) => `${key} = EXCLUDED.${key}`)
        .join(', ');
      const params = keys.map((key) => {
        const value = values[key];
        if (key === 'raw_payload' || key === 'photos' || key === 'geojson') {
          return value == null ? null : JSON.stringify(value);
        }
        return value;
      });

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO ${spec.table} (${columns})
         VALUES (${placeholders})
         ON CONFLICT (farm_id, local_id) DO UPDATE SET
           ${updateColumns},
           updated_at = NOW()
         RETURNING id`,
        params,
      );
      const id = rows[0]?.id;
      if (!id) throw new Error('upsert returned no id');
      mapping[lid] = id;
      await logSync(client, farmId, {
        module,
        entity: spec.entity,
        local_id: lid,
        cloud_id: id,
        action: 'push',
        status: 'ok',
        device_id: deviceId,
      });
      if (module === 'monitoring-report') {
        await upsertMonitoringChildren(client, farmId, id, lid, record, deviceId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ local_id: lid, error: message });
      await logSync(client, farmId, {
        module,
        entity: spec.entity,
        local_id: lid,
        action: 'push',
        status: 'error',
        error_message: message,
        device_id: deviceId,
      });
    }
  }

  return { mapping, failed };
}

async function upsertMonitoringChildren(
  client: PoolClient,
  farmId: string,
  reportId: string,
  reportLocalId: string,
  record: Record<string, unknown>,
  deviceId: string,
): Promise<void> {
  await upsertChildArray(client, farmId, reportId, reportLocalId, 'points', 'monitoring_points', record.points, deviceId);
  await upsertChildArray(client, farmId, reportId, reportLocalId, 'pests', 'monitoring_pests', record.pests, deviceId);
  await upsertChildArray(client, farmId, reportId, reportLocalId, 'diseases', 'monitoring_diseases', record.diseases, deviceId);
  await upsertChildArray(client, farmId, reportId, reportLocalId, 'weeds', 'monitoring_weeds', record.weeds, deviceId);
}

async function upsertChildArray(
  client: PoolClient,
  farmId: string,
  reportId: string,
  reportLocalId: string,
  entity: 'points' | 'pests' | 'diseases' | 'weeds',
  table: 'monitoring_points' | 'monitoring_pests' | 'monitoring_diseases' | 'monitoring_weeds',
  raw: unknown,
  deviceId: string,
): Promise<void> {
  if (!Array.isArray(raw)) return;
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const lid = localId(row) || `${reportLocalId}:${entity}:${i}`;
    try {
      if (table === 'monitoring_points') {
        await client.query(
          `INSERT INTO monitoring_points (local_id, farm_id, monitoring_report_id, latitude, longitude, notes, raw_payload)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (farm_id, local_id) DO UPDATE SET
             monitoring_report_id = EXCLUDED.monitoring_report_id,
             latitude = EXCLUDED.latitude,
             longitude = EXCLUDED.longitude,
             notes = EXCLUDED.notes,
             raw_payload = EXCLUDED.raw_payload,
             updated_at = NOW()`,
          [lid, farmId, reportId, num(row, 'latitude'), num(row, 'longitude'), str(row, 'notes'), JSON.stringify(row)],
        );
      } else {
        await client.query(
          `INSERT INTO ${table} (local_id, farm_id, monitoring_report_id, name, severity, raw_payload)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT (farm_id, local_id) DO UPDATE SET
             monitoring_report_id = EXCLUDED.monitoring_report_id,
             name = EXCLUDED.name,
             severity = EXCLUDED.severity,
             raw_payload = EXCLUDED.raw_payload,
             updated_at = NOW()`,
          [
            lid,
            farmId,
            reportId,
            str(row, 'name') ?? str(row, 'nome') ?? str(row, 'organism_name'),
            str(row, 'severity') ?? str(row, 'severity_level'),
            JSON.stringify(row),
          ],
        );
      }
    } catch (error) {
      await logSync(client, farmId, {
        module: 'monitoring-report',
        entity,
        local_id: lid,
        action: 'push',
        status: 'error',
        error_message: error instanceof Error ? error.message : String(error),
        device_id: deviceId,
      });
    }
  }
}

export async function loadOperationalRows(
  client: PoolClient,
  module: OperationalModule,
  farmId: string,
): Promise<Record<string, unknown>[]> {
  const spec = getOperationalSpec(module);
  const { rows } = await client.query<Record<string, unknown>>(
    `SELECT * FROM ${spec.table}
     WHERE farm_id = $1 AND deleted_at IS NULL
     ORDER BY updated_at DESC`,
    [farmId],
  );
  return rows;
}
