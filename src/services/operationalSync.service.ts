import type { Pool } from 'pg';
import { HttpError } from '../middleware/errorHandler.js';
import {
  logSync,
  upsertOperationalRecords,
  type ItemFailure,
} from '../repositories/operationalSync.repository.js';
import type {
  OperationalModule,
  OperationalPushBody,
} from '../validators/operationalSync.validator.js';

export type OperationalPushResult = {
  farm_cloud_id: string;
  mapping: Record<string, unknown>;
  failed: ItemFailure[];
  synced_at: string;
};

async function validateFarmLink(
  client: import('pg').PoolClient,
  apiKeyId: string,
  body: OperationalPushBody,
): Promise<string> {
  const { rows: keyRows } = await client.query<{ farm_id: string | null }>(
    `SELECT farm_id FROM api_keys WHERE id = $1 FOR UPDATE`,
    [apiKeyId],
  );
  const linkedFarmId = keyRows[0]?.farm_id ?? null;
  if (!linkedFarmId) {
    throw new HttpError('Faça primeiro a sincronização base para vincular a fazenda.', 403);
  }
  if (linkedFarmId.toLowerCase() !== body.farm_cloud_id.toLowerCase()) {
    throw new HttpError('farm_cloud_id does not match the farm linked to this API key', 403);
  }
  return linkedFarmId;
}

async function ensureOperationalCompatibilityColumns(
  client: import('pg').PoolClient,
): Promise<void> {
  await client.query(`
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS material_name TEXT;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS crop_name TEXT;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS plot_name TEXT;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS subarea_name TEXT;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS emergence_date DATE;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS evaluation_date TIMESTAMPTZ;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS dap INTEGER;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS dae INTEGER;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS population_per_meter NUMERIC;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS spacing_cm NUMERIC;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS stand_cv_percent NUMERIC;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS stand_classification TEXT;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS plants_counted NUMERIC;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS meters_evaluated NUMERIC;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS plot_geojson JSONB;
    ALTER TABLE planting_records ADD COLUMN IF NOT EXISTS subarea_geojson JSONB;
    ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS plot_name TEXT;
    ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS subarea_name TEXT;
    ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS crop_name TEXT;
    ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS season_cloud_id UUID;
    ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS crop_cloud_id UUID;
    ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS summary JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE monitoring_points ADD COLUMN IF NOT EXISTS point_code TEXT;
    ALTER TABLE monitoring_points ADD COLUMN IF NOT EXISTS cloud_id UUID;
    ALTER TABLE monitoring_points ADD COLUMN IF NOT EXISTS accuracy_m NUMERIC;
    ALTER TABLE monitoring_points ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ;
    ALTER TABLE monitoring_points ADD COLUMN IF NOT EXISTS observations TEXT;
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS monitoring_occurrences (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      local_id TEXT NOT NULL,
      farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
      monitoring_report_id UUID REFERENCES monitoring_reports (id) ON DELETE CASCADE,
      monitoring_point_id UUID REFERENCES monitoring_points (id) ON DELETE CASCADE,
      type TEXT,
      name TEXT,
      scientific_name TEXT,
      class_name TEXT,
      infestation_level TEXT,
      infestation_score NUMERIC,
      incidence_percent NUMERIC,
      severity_percent NUMERIC,
      plants_affected NUMERIC,
      sample_size NUMERIC,
      risk_level TEXT,
      requires_action BOOLEAN DEFAULT FALSE,
      observations TEXT,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT monitoring_occurrences_farm_local_unique UNIQUE (farm_id, local_id)
    );
    CREATE TABLE IF NOT EXISTS monitoring_recommendations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      local_id TEXT NOT NULL,
      farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
      occurrence_id UUID REFERENCES monitoring_occurrences (id) ON DELETE CASCADE,
      source TEXT,
      simple_text TEXT,
      priority TEXT,
      action_type TEXT,
      generated_at TIMESTAMPTZ,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT monitoring_recommendations_farm_local_unique UNIQUE (farm_id, local_id)
    );
    ALTER TABLE monitoring_recommendations
      ADD COLUMN IF NOT EXISTS occurrence_id UUID REFERENCES monitoring_occurrences (id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_monitoring_recommendations_occurrence_id
      ON monitoring_recommendations (occurrence_id);
    CREATE TABLE IF NOT EXISTS monitoring_images (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      local_id TEXT NOT NULL,
      farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
      monitoring_report_id UUID REFERENCES monitoring_reports (id) ON DELETE CASCADE,
      monitoring_point_id UUID REFERENCES monitoring_points (id) ON DELETE CASCADE,
      occurrence_id UUID REFERENCES monitoring_occurrences (id) ON DELETE CASCADE,
      file_name TEXT,
      local_path TEXT,
      cloud_url TEXT,
      caption TEXT,
      taken_at TIMESTAMPTZ,
      latitude NUMERIC,
      longitude NUMERIC,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT monitoring_images_farm_local_unique UNIQUE (farm_id, local_id)
    );
  `);
}

export async function pushOperationalSync(
  pool: Pool,
  apiKeyId: string,
  module: OperationalModule,
  body: OperationalPushBody,
): Promise<OperationalPushResult> {
  const synced_at = new Date().toISOString();
  const client = await pool.connect();
  try {
    await ensureOperationalCompatibilityColumns(client);
    await client.query('BEGIN');
    const farmId = await validateFarmLink(client, apiKeyId, body);
    const result = await upsertOperationalRecords(
      client,
      module,
      farmId,
      body.records,
      body.device_id,
    );
    await logSync(client, farmId, {
      module,
      action: 'push',
      status: result.failed.length === 0 ? 'ok' : 'partial',
      error_message:
        result.failed.length === 0 ? undefined : `${result.failed.length} item(s) falharam`,
      device_id: body.device_id,
    });
    await client.query('COMMIT');
    return {
      farm_cloud_id: farmId,
      mapping: result.mapping,
      failed: result.failed,
      synced_at,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
