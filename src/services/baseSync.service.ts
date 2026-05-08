import type { Pool } from 'pg';
import { HttpError } from '../middleware/errorHandler.js';
import type { GeoJsonPolygon } from '../utils/normalizeGeojson.js';
import { tryNormalizeGeojson } from '../utils/normalizeGeojson.js';
import type { BasePushBody } from '../validators/baseSync.validator.js';

const RFC4122_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v: string): boolean {
  return RFC4122_UUID.test(v.trim());
}

/** Geo opcional: ausência/null → sem geometria; Polygon válido → guardado; inválido → null + flag para sync_logs warning */
function classifyGeojson(raw: unknown): {
  normalized: GeoJsonPolygon | null;
  invalidProvided: boolean;
} {
  if (raw == null || raw === '') {
    return { normalized: null, invalidProvided: false };
  }
  const gj = tryNormalizeGeojson(raw);
  if (gj) {
    return { normalized: gj, invalidProvided: false };
  }
  return { normalized: null, invalidProvided: true };
}

function safePushLog(message: string, data: Record<string, unknown>): void {
  console.info(`[pushBaseSync] ${message}`, JSON.stringify(data));
}

function plotLocalFromPayload(o: Record<string, unknown>): string {
  const pl = o.plot_local_id;
  if (typeof pl === 'string' && pl.trim() !== '') return pl.trim();
  if (typeof pl === 'number' && Number.isFinite(pl)) return String(pl);
  return '';
}

function plotCloudIdFromPayload(o: Record<string, unknown>): string | null {
  const v = o.plot_cloud_id;
  if (v == null || v === '') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** Aceita string ou número (SQLite / JSON); também local_id em falta com campo id */
function normalizeEntityLocalId(o: Record<string, unknown>): string {
  const raw = o.local_id ?? o.id;
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return String(raw).trim();
}

export type Mapping = {
  farms: Record<string, string>;
  plots: Record<string, string>;
  subareas: Record<string, string>;
  seasons: Record<string, string>;
  crops: Record<string, string>;
};

export type PushBaseResult = {
  farm_cloud_id: string;
  mapping: Mapping;
  synced_at: string;
};

function optionalIsoTimestamp(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseDateOnly(v: unknown): string | null {
  if (v == null || v === '') return null;
  const d = new Date(String(v).trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function optionalStrField(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

async function logSync(
  client: import('pg').PoolClient,
  farmId: string | null,
  opts: {
    module: string;
    entity?: string;
    local_id?: string;
    cloud_id?: string;
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

async function ensureBaseSyncCompatibilityColumns(
  client: import('pg').PoolClient,
): Promise<void> {
  await client.query(`
    ALTER TABLE crops ADD COLUMN IF NOT EXISTS family TEXT;
    ALTER TABLE crops ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE seasons ADD COLUMN IF NOT EXISTS start_date DATE;
    ALTER TABLE seasons ADD COLUMN IF NOT EXISTS end_date DATE;
  `);
}

export async function pushBaseSync(
  pool: Pool,
  apiKeyId: string,
  body: BasePushBody,
  dryRun: boolean,
): Promise<PushBaseResult> {
  const mapping: Mapping = {
    farms: {},
    plots: {},
    subareas: {},
    seasons: {},
    crops: {},
  };
  const synced_at = new Date().toISOString();
  const client = await pool.connect();
  try {
    await ensureBaseSyncCompatibilityColumns(client);
    await client.query('BEGIN');

    const { rows: keyRows } = await client.query<{ farm_id: string | null }>(
      `SELECT farm_id FROM api_keys WHERE id = $1 FOR UPDATE`,
      [apiKeyId],
    );
    const lockedFarmId = keyRows[0]?.farm_id ?? null;

    const f = body.farm;
    const farmDeletedAt = optionalIsoTimestamp(f.deleted_at);
    const farmUpdatedAt = optionalIsoTimestamp(f.updated_at) ?? synced_at;

    const { rows: farmUpsert } = await client.query<{ id: string; local_id: string }>(
      `INSERT INTO farms (local_id, name, owner_name, city, state, total_area_ha, updated_at, deleted_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9)
       ON CONFLICT (local_id) DO UPDATE SET
         name = EXCLUDED.name,
         owner_name = EXCLUDED.owner_name,
         city = EXCLUDED.city,
         state = EXCLUDED.state,
         total_area_ha = EXCLUDED.total_area_ha,
         updated_at = EXCLUDED.updated_at,
         deleted_at = EXCLUDED.deleted_at,
         is_active = EXCLUDED.is_active
       RETURNING id, local_id`,
      [
        f.local_id,
        f.name,
        f.owner_name,
        f.city,
        f.state,
        f.total_area_ha,
        farmUpdatedAt,
        farmDeletedAt,
        farmDeletedAt == null,
      ],
    );
    const farmRow = farmUpsert[0];
    if (!farmRow) {
      throw new HttpError('Failed to upsert farm', 500);
    }
    const farmId = farmRow.id;
    mapping.farms[f.local_id] = farmId;

    if (lockedFarmId === null) {
      const link = await client.query(`UPDATE api_keys SET farm_id = $1 WHERE id = $2 AND farm_id IS NULL`, [
        farmId,
        apiKeyId,
      ]);
      if (link.rowCount === 0) {
        const { rows: again } = await client.query<{ farm_id: string | null }>(
          `SELECT farm_id FROM api_keys WHERE id = $1`,
          [apiKeyId],
        );
        const nowFid = again[0]?.farm_id;
        if (nowFid !== farmId) {
          throw new HttpError('API key is already linked to another farm', 403);
        }
      }
    } else {
      if (lockedFarmId !== farmId) {
        throw new HttpError('farm_local_id does not match the farm linked to this API key', 403);
      }
    }

    const plotLocalToId = new Map<string, string>();

    safePushLog('incoming_counts', {
      plotsReceived: body.plots.length,
      subareasReceived: body.subareas.length,
      seasonsReceived: body.seasons.length,
      cropsReceived: body.crops.length,
      farmLocalId: body.farm_local_id,
    });

    let plotsSaved = 0;
    let plotsSkippedMissingId = 0;

    for (const raw of body.plots) {
      const o = raw as Record<string, unknown>;
      const localId = normalizeEntityLocalId(o);
      const name = typeof o.name === 'string' ? o.name : '';
      if (!localId) {
        plotsSkippedMissingId += 1;
        await logSync(client, farmId, {
          module: 'base',
          entity: 'plot',
          status: 'error',
          error_message: 'missing local_id',
          device_id: body.device_id,
        });
        continue;
      }
      const geo = classifyGeojson(o.geojson);
      if (geo.invalidProvided) {
        await logSync(client, farmId, {
          module: 'base',
          entity: 'plot',
          local_id: localId,
          status: 'warning',
          error_message:
            'geojson provided but invalid or not a valid Polygon; plot saved without geometry',
          device_id: body.device_id,
        });
      }
      const area = o.area_ha == null ? null : Number(o.area_ha);
      const perimeter = o.perimeter_m == null ? null : Number(o.perimeter_m);
      const cLat = o.centroid_lat == null ? null : Number(o.centroid_lat);
      const cLng = o.centroid_lng == null ? null : Number(o.centroid_lng);
      const perimeterVal = perimeter != null && Number.isFinite(perimeter) ? perimeter : null;
      const updatedAt = optionalIsoTimestamp(
        typeof o.updated_at === 'string' ? o.updated_at : null,
      ) ?? synced_at;
      const delAt = optionalIsoTimestamp(typeof o.deleted_at === 'string' ? o.deleted_at : null);

      const geojsonParam = geo.normalized;

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO plots (farm_id, local_id, name, area_ha, perimeter_m, centroid_lat, centroid_lng, geojson, updated_at, deleted_at, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz, $10::timestamptz, $11)
         ON CONFLICT (farm_id, local_id) DO UPDATE SET
           name = EXCLUDED.name,
           area_ha = EXCLUDED.area_ha,
           perimeter_m = EXCLUDED.perimeter_m,
           centroid_lat = EXCLUDED.centroid_lat,
           centroid_lng = EXCLUDED.centroid_lng,
           geojson = EXCLUDED.geojson,
           updated_at = EXCLUDED.updated_at,
           deleted_at = EXCLUDED.deleted_at,
           is_active = EXCLUDED.is_active
         RETURNING id`,
        [
          farmId,
          localId,
          name || localId,
          area != null && Number.isFinite(area) ? area : null,
          perimeterVal,
          cLat != null && Number.isFinite(cLat) ? cLat : null,
          cLng != null && Number.isFinite(cLng) ? cLng : null,
          geojsonParam,
          updatedAt,
          delAt,
          delAt == null,
        ],
      );
      const pid = rows[0]?.id;
      if (pid) {
        plotsSaved += 1;
        plotLocalToId.set(localId, pid);
        mapping.plots[localId] = pid;
      }
    }

    const { rows: plotRowsFarm } = await client.query<{ id: string; local_id: string }>(
      `SELECT id, local_id FROM plots WHERE farm_id = $1`,
      [farmId],
    );
    for (const pr of plotRowsFarm) {
      plotLocalToId.set(pr.local_id, pr.id);
    }

    safePushLog('plots_processed', {
      plotsReceived: body.plots.length,
      plotsSavedFromPayload: plotsSaved,
      plotsSkippedMissingLocalId: plotsSkippedMissingId,
      plotsTotalInDbForFarm: plotRowsFarm.length,
      mappingPlotsCount: Object.keys(mapping.plots).length,
    });

    for (const raw of body.seasons) {
      const o = raw as Record<string, unknown>;
      const localId =
        typeof o.local_id === 'string' && o.local_id.trim() !== '' ? o.local_id.trim() : '';
      if (!localId) {
        await logSync(client, farmId, {
          module: 'base',
          entity: 'season',
          status: 'error',
          error_message: 'missing local_id',
          device_id: body.device_id,
        });
        continue;
      }
      const seasonName = typeof o.name === 'string' ? o.name : '';
      const cropName = optionalStrField(o.crop_name);
      const startD = parseDateOnly(o.start_date);
      const endD = parseDateOnly(o.end_date);
      const updatedAt =
        optionalIsoTimestamp(typeof o.updated_at === 'string' ? o.updated_at : null) ?? synced_at;
      const delAt = optionalIsoTimestamp(typeof o.deleted_at === 'string' ? o.deleted_at : null);

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO seasons (farm_id, local_id, name, crop_name, start_date, end_date, updated_at, deleted_at, is_active)
         VALUES ($1, $2, $3, $4, $5::date, $6::date, $7::timestamptz, $8::timestamptz, $9)
         ON CONFLICT (farm_id, local_id) DO UPDATE SET
           name = EXCLUDED.name,
           crop_name = EXCLUDED.crop_name,
           start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date,
           updated_at = EXCLUDED.updated_at,
           deleted_at = EXCLUDED.deleted_at,
           is_active = EXCLUDED.is_active
         RETURNING id`,
        [farmId, localId, seasonName || localId, cropName, startD, endD, updatedAt, delAt, delAt == null],
      );
      const sid = rows[0]?.id;
      if (sid) mapping.seasons[localId] = sid;
    }

    for (const raw of body.crops) {
      const o = raw as Record<string, unknown>;
      const localId =
        typeof o.local_id === 'string' && o.local_id.trim() !== '' ? o.local_id.trim() : '';
      if (!localId) {
        await logSync(client, farmId, {
          module: 'base',
          entity: 'crop',
          status: 'error',
          error_message: 'missing local_id',
          device_id: body.device_id,
        });
        continue;
      }
      const cropName = typeof o.name === 'string' ? o.name : '';
      const sci = optionalStrField(o.scientific_name);
      const fam = optionalStrField(o.family);
      const desc = optionalStrField(o.description);
      const updatedAt =
        optionalIsoTimestamp(typeof o.updated_at === 'string' ? o.updated_at : null) ?? synced_at;
      const delAt = optionalIsoTimestamp(typeof o.deleted_at === 'string' ? o.deleted_at : null);

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO crops (farm_id, local_id, name, scientific_name, family, description, updated_at, deleted_at, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9)
         ON CONFLICT (farm_id, local_id) DO UPDATE SET
           name = EXCLUDED.name,
           scientific_name = EXCLUDED.scientific_name,
           family = EXCLUDED.family,
           description = EXCLUDED.description,
           updated_at = EXCLUDED.updated_at,
           deleted_at = EXCLUDED.deleted_at,
           is_active = EXCLUDED.is_active
         RETURNING id`,
        [farmId, localId, cropName || localId, sci, fam, desc, updatedAt, delAt, delAt == null],
      );
      const cid = rows[0]?.id;
      if (cid) mapping.crops[localId] = cid;
    }

    let subareasSaved = 0;

    for (const raw of body.subareas) {
      const o = raw as Record<string, unknown>;
      const localId = normalizeEntityLocalId(o);
      const plotLocal = plotLocalFromPayload(o);
      const plotCloudRaw = plotCloudIdFromPayload(o);

      if (!localId) {
        await logSync(client, farmId, {
          module: 'base',
          entity: 'subarea',
          status: 'error',
          error_message: 'missing local_id',
          device_id: body.device_id,
        });
        continue;
      }
      if (!plotLocal && !plotCloudRaw) {
        await logSync(client, farmId, {
          module: 'base',
          entity: 'subarea',
          local_id: localId,
          status: 'error',
          error_message: 'missing plot_local_id and plot_cloud_id',
          device_id: body.device_id,
        });
        continue;
      }

      let resolvedPlotId: string | null = null;
      if (plotCloudRaw && isUuid(plotCloudRaw)) {
        const { rows: matchCloud } = await client.query<{ id: string }>(
          `SELECT id FROM plots WHERE farm_id = $1 AND id = $2::uuid LIMIT 1`,
          [farmId, plotCloudRaw.trim()],
        );
        resolvedPlotId = matchCloud[0]?.id ?? null;
      }
      if (!resolvedPlotId && plotLocal) {
        resolvedPlotId = plotLocalToId.get(plotLocal) ?? null;
      }

      if (!resolvedPlotId) {
        await logSync(client, farmId, {
          module: 'base',
          entity: 'subarea',
          local_id: localId,
          status: 'error',
          error_message: `plot not found for plot_local_id=${plotLocal || '—'} plot_cloud_id=${plotCloudRaw ?? '—'}`,
          device_id: body.device_id,
        });
        continue;
      }

      const geo = classifyGeojson(o.geojson);
      if (geo.invalidProvided) {
        await logSync(client, farmId, {
          module: 'base',
          entity: 'subarea',
          local_id: localId,
          status: 'warning',
          error_message:
            'geojson provided but invalid or not a valid Polygon; subarea saved without geometry',
          device_id: body.device_id,
        });
      }

      const subName = typeof o.name === 'string' ? o.name : '';
      const treatment = optionalStrField(o.treatment_name);
      const area = o.area_ha == null ? null : Number(o.area_ha);
      const cLat = o.centroid_lat == null ? null : Number(o.centroid_lat);
      const cLng = o.centroid_lng == null ? null : Number(o.centroid_lng);
      const updatedAt =
        optionalIsoTimestamp(typeof o.updated_at === 'string' ? o.updated_at : null) ?? synced_at;
      const delAt = optionalIsoTimestamp(typeof o.deleted_at === 'string' ? o.deleted_at : null);

      const plotLocalPersist = plotLocal || null;

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO subareas (farm_id, plot_id, local_id, plot_local_id, name, treatment_name, area_ha, centroid_lat, centroid_lng, geojson, updated_at, deleted_at, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz, $12::timestamptz, $13)
         ON CONFLICT (farm_id, local_id) DO UPDATE SET
           plot_id = EXCLUDED.plot_id,
           plot_local_id = EXCLUDED.plot_local_id,
           name = EXCLUDED.name,
           treatment_name = EXCLUDED.treatment_name,
           area_ha = EXCLUDED.area_ha,
           centroid_lat = EXCLUDED.centroid_lat,
           centroid_lng = EXCLUDED.centroid_lng,
           geojson = EXCLUDED.geojson,
           updated_at = EXCLUDED.updated_at,
           deleted_at = EXCLUDED.deleted_at,
           is_active = EXCLUDED.is_active
         RETURNING id`,
        [
          farmId,
          resolvedPlotId,
          localId,
          plotLocalPersist,
          subName || localId,
          treatment,
          area != null && Number.isFinite(area) ? area : null,
          cLat != null && Number.isFinite(cLat) ? cLat : null,
          cLng != null && Number.isFinite(cLng) ? cLng : null,
          geo.normalized,
          updatedAt,
          delAt,
          delAt == null,
        ],
      );
      const sid = rows[0]?.id;
      if (sid) {
        subareasSaved += 1;
        mapping.subareas[localId] = sid;
      }
    }

    safePushLog('subareas_processed', {
      subareasReceived: body.subareas.length,
      subareasSaved,
      mappingSubareasCount: Object.keys(mapping.subareas).length,
    });

    await logSync(client, farmId, {
      module: 'base',
      status: 'ok',
      action: dryRun ? 'push_dry_run' : 'push',
      device_id: body.device_id,
    });

    safePushLog('mapping_summary', {
      dryRun,
      mappingFarms: Object.keys(mapping.farms).length,
      mappingPlots: Object.keys(mapping.plots).length,
      mappingSubareas: Object.keys(mapping.subareas).length,
      mappingSeasons: Object.keys(mapping.seasons).length,
      mappingCrops: Object.keys(mapping.crops).length,
    });

    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }

    return { farm_cloud_id: farmId, mapping, synced_at };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
