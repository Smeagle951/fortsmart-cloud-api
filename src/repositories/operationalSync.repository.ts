import type { PoolClient } from 'pg';
import type { OperationalModule } from '../validators/operationalSync.validator.js';

export type ItemFailure = {
  local_id: string | null;
  error: string;
};

export type OperationalUpsertResult = {
  mapping: Record<string, unknown>;
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
        plot_name: str(record, 'plot_name'),
        subarea_name: str(record, 'subarea_name'),
        season_local_id: str(record, 'season_local_id'),
        season_cloud_id: uuid(record, 'season_cloud_id'),
        crop_local_id: str(record, 'crop_local_id'),
        crop_cloud_id: uuid(record, 'crop_cloud_id'),
        crop_name: str(record, 'crop_name'),
        report_date: iso(record.monitoring_date ?? record.date ?? record.evaluation_date),
        phenological_stage: str(record, 'phenological_stage'),
        technician_name: str(record, 'technician_name'),
        observations: str(record, 'general_observations') ?? str(record, 'observations') ?? str(record, 'notes'),
        status: str(record, 'status'),
        summary: json(record.summary, {}),
        schema_version: str(record, 'schema_version'),
        plot_geojson: record.plot_geojson ?? null,
        organisms_detected: json(record.organisms_detected, []),
        recommendations: json(record.recommendations, []),
        integrated_management: json(record.integrated_management, []),
        economic_impacts: json(record.economic_impacts, []),
        stand_context: json(record.stand_context, {}),
        environment_context: json(record.environment_context, {}),
        planting_context: json(record.planting_context, {}),
        dashboard_summary: json(record.dashboard_summary, {}),
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
        plot_name: str(record, 'plot_name'),
        subarea_name: str(record, 'subarea_name'),
        season_local_id: str(record, 'season_local_id'),
        season_cloud_id: uuid(record, 'season_cloud_id'),
        crop_local_id: str(record, 'crop_local_id'),
        crop_cloud_id: uuid(record, 'crop_cloud_id'),
        crop_name: str(record, 'crop_name'),
        material_name: str(record, 'material_name'),
        variety_name: str(record, 'variety_name') ?? str(record, 'material') ?? str(record, 'hibrido'),
        planting_date: dateOnly(record.planting_date ?? record.date),
        emergence_date: dateOnly(record.emergence_date),
        evaluation_date: iso(record.evaluation_date),
        dap: num(record, 'dap'),
        dae: num(record, 'dae'),
        spacing_m: num(record, 'spacing_m'),
        spacing_cm: num(record, 'spacing_cm'),
        planned_population: num(record, 'planned_population'),
        real_population: num(record, 'real_population'),
        population_per_meter: num(record, 'population_per_meter'),
        area_ha: num(record, 'area_ha'),
        stand_cv_percent: num(record, 'stand_cv_percent'),
        stand_classification: str(record, 'stand_classification'),
        plants_counted: num(record, 'plants_counted'),
        meters_evaluated: num(record, 'meters_evaluated'),
        plot_geojson: record.plot_geojson ?? null,
        subarea_geojson: record.subarea_geojson ?? null,
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
  const mapping: Record<string, unknown> = {};
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
      if (module === 'monitoring-report') {
        const result = await upsertMonitoringReport(client, farmId, record, deviceId);
        const reports = (mapping.reports as Record<string, string> | undefined) ?? {};
        const points = (mapping.points as Record<string, string> | undefined) ?? {};
        const occurrences = (mapping.occurrences as Record<string, string> | undefined) ?? {};
        const recommendations = (mapping.recommendations as Record<string, string> | undefined) ?? {};
        const images = (mapping.images as Record<string, string> | undefined) ?? {};
        mapping.reports = { ...reports, ...result.mapping.reports };
        mapping.points = { ...points, ...result.mapping.points };
        mapping.occurrences = { ...occurrences, ...result.mapping.occurrences };
        mapping.recommendations = { ...recommendations, ...result.mapping.recommendations };
        mapping.images = { ...images, ...result.mapping.images };
        await logSync(client, farmId, {
          module,
          entity: spec.entity,
          local_id: lid,
          cloud_id: result.reportId,
          action: 'push',
          status: 'ok',
          device_id: deviceId,
        });
        continue;
      }
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

type MonitoringMapping = {
  reports: Record<string, string>;
  points: Record<string, string>;
  occurrences: Record<string, string>;
  recommendations: Record<string, string>;
  images: Record<string, string>;
};

async function upsertMonitoringReport(
  client: PoolClient,
  farmId: string,
  record: Record<string, unknown>,
  deviceId: string,
): Promise<{ reportId: string; mapping: MonitoringMapping }> {
  const spec = getOperationalSpec('monitoring-report');
  const values = spec.buildValues(record, farmId);
  const reportId = await upsertGeneric(client, spec.table, values, [
    'raw_payload',
    'summary',
    'plot_geojson',
    'organisms_detected',
    'recommendations',
    'integrated_management',
    'economic_impacts',
    'stand_context',
    'environment_context',
    'planting_context',
    'dashboard_summary',
  ]);
  const reportLocalId = localId(record);
  const mapping: MonitoringMapping = {
    reports: { [reportLocalId]: reportId },
    points: {},
    occurrences: {},
    recommendations: {},
    images: {},
  };

  const points = Array.isArray(record.points) ? record.points : [];
  for (let i = 0; i < points.length; i += 1) {
    const rawPoint = points[i];
    if (typeof rawPoint !== 'object' || rawPoint === null || Array.isArray(rawPoint)) continue;
    const point = rawPoint as Record<string, unknown>;
    const pointLocalId = localId(point) || `${reportLocalId}:point:${i}`;
    try {
      const pointId = await upsertGeneric(
        client,
        'monitoring_points',
        {
          local_id: pointLocalId,
          farm_id: farmId,
          monitoring_report_id: reportId,
          point_code: str(point, 'point_code'),
          latitude: num(point, 'latitude'),
          longitude: num(point, 'longitude'),
          accuracy_m: num(point, 'accuracy_m'),
          collected_at: iso(point.collected_at),
          notes: str(point, 'notes') ?? str(point, 'observations'),
          observations: str(point, 'observations'),
          raw_payload: point,
        },
        ['raw_payload'],
      );
      mapping.points[pointLocalId] = pointId;
      await upsertMonitoringImages(client, farmId, reportId, pointId, null, point.images, `${pointLocalId}:image`, mapping, deviceId);

      const occurrences = Array.isArray(point.occurrences) ? point.occurrences : [];
      for (let j = 0; j < occurrences.length; j += 1) {
        const rawOccurrence = occurrences[j];
        if (typeof rawOccurrence !== 'object' || rawOccurrence === null || Array.isArray(rawOccurrence)) continue;
        const occurrence = rawOccurrence as Record<string, unknown>;
        const occurrenceLocalId = localId(occurrence) || `${pointLocalId}:occurrence:${j}`;
        try {
          const occurrenceId = await upsertGeneric(
            client,
            'monitoring_occurrences',
            {
              local_id: occurrenceLocalId,
              farm_id: farmId,
              monitoring_report_id: reportId,
              monitoring_point_id: pointId,
              type: str(occurrence, 'type'),
              name: str(occurrence, 'name'),
              scientific_name: str(occurrence, 'scientific_name'),
              class_name: str(occurrence, 'class_name'),
              infestation_level: str(occurrence, 'infestation_level'),
              infestation_score: num(occurrence, 'infestation_score'),
              incidence_percent: num(occurrence, 'incidence_percent'),
              severity_percent: num(occurrence, 'severity_percent'),
              plants_affected: num(occurrence, 'plants_affected'),
              sample_size: num(occurrence, 'sample_size'),
              risk_level: str(occurrence, 'risk_level'),
              requires_action: Boolean(occurrence.requires_action),
              observations: str(occurrence, 'observations'),
              raw_payload: occurrence,
            },
            ['raw_payload'],
          );
          mapping.occurrences[occurrenceLocalId] = occurrenceId;
          await upsertMonitoringRecommendation(client, farmId, occurrenceId, occurrenceLocalId, occurrence.recommendation, mapping, deviceId);
          await upsertMonitoringImages(client, farmId, reportId, pointId, occurrenceId, occurrence.images, `${occurrenceLocalId}:image`, mapping, deviceId);
        } catch (error) {
          await logSync(client, farmId, {
            module: 'monitoring-report',
            entity: 'occurrences',
            local_id: occurrenceLocalId,
            action: 'push',
            status: 'error',
            error_message: error instanceof Error ? error.message : String(error),
            device_id: deviceId,
          });
        }
      }
    } catch (error) {
      await logSync(client, farmId, {
        module: 'monitoring-report',
        entity: 'points',
        local_id: pointLocalId,
        action: 'push',
        status: 'error',
        error_message: error instanceof Error ? error.message : String(error),
        device_id: deviceId,
      });
    }
  }

  return { reportId, mapping };
}

async function upsertMonitoringRecommendation(
  client: PoolClient,
  farmId: string,
  occurrenceId: string,
  occurrenceLocalId: string,
  raw: unknown,
  mapping: MonitoringMapping,
  deviceId: string,
): Promise<void> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return;
  const recommendation = raw as Record<string, unknown>;
  const simpleText = str(recommendation, 'simple_text');
  if (!simpleText) return;
  const local = localId(recommendation) || `${occurrenceLocalId}:recommendation`;
  try {
    const id = await upsertGeneric(
      client,
      'monitoring_recommendations',
      {
        local_id: local,
        farm_id: farmId,
        occurrence_id: occurrenceId,
        source: str(recommendation, 'source'),
        simple_text: simpleText,
        priority: str(recommendation, 'priority'),
        action_type: str(recommendation, 'action_type'),
        generated_at: iso(recommendation.generated_at),
        raw_payload: recommendation,
      },
      ['raw_payload'],
    );
    mapping.recommendations[local] = id;
  } catch (error) {
    await logSync(client, farmId, {
      module: 'monitoring-report',
      entity: 'recommendations',
      local_id: local,
      action: 'push',
      status: 'error',
      error_message: error instanceof Error ? error.message : String(error),
      device_id: deviceId,
    });
  }
}

async function upsertMonitoringImages(
  client: PoolClient,
  farmId: string,
  reportId: string,
  pointId: string | null,
  occurrenceId: string | null,
  raw: unknown,
  fallbackPrefix: string,
  mapping: MonitoringMapping,
  deviceId: string,
): Promise<void> {
  if (!Array.isArray(raw)) return;
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const image = item as Record<string, unknown>;
    const lid = localId(image) || `${fallbackPrefix}:${i}`;
    try {
      const id = await upsertGeneric(
        client,
        'monitoring_images',
        {
          local_id: lid,
          farm_id: farmId,
          monitoring_report_id: reportId,
          monitoring_point_id: pointId,
          occurrence_id: occurrenceId,
          file_name: str(image, 'file_name'),
          local_path: str(image, 'local_path'),
          cloud_url: str(image, 'cloud_url'),
          cloud_storage_key: str(image, 'cloud_storage_key'),
          cloud_expires_at: iso(image.cloud_expires_at),
          caption: str(image, 'caption'),
          taken_at: iso(image.taken_at),
          latitude: num(image, 'latitude'),
          longitude: num(image, 'longitude'),
          raw_payload: image,
        },
        ['raw_payload'],
      );
      mapping.images[lid] = id;
    } catch (error) {
      await logSync(client, farmId, {
        module: 'monitoring-report',
        entity: 'images',
        local_id: lid,
        action: 'push',
        status: 'error',
        error_message: error instanceof Error ? error.message : String(error),
        device_id: deviceId,
      });
    }
  }
}

export async function upsertGeneric(
  client: PoolClient,
  table: string,
  values: Record<string, unknown>,
  jsonColumns: string[],
): Promise<string> {
  const keys = Object.keys(values);
  const columns = keys.join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const updateColumns = keys
    .filter((key) => key !== 'id' && key !== 'farm_id' && key !== 'local_id' && key !== 'created_at')
    .map((key) => `${key} = EXCLUDED.${key}`)
    .join(', ');
  const params = keys.map((key) => {
    const value = values[key];
    return jsonColumns.includes(key) && value != null ? JSON.stringify(value) : value;
  });
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO ${table} (${columns})
     VALUES (${placeholders})
     ON CONFLICT (farm_id, local_id) DO UPDATE SET
       ${updateColumns},
       updated_at = NOW()
     RETURNING id`,
    params,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`${table} upsert returned no id`);
  return id;
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
