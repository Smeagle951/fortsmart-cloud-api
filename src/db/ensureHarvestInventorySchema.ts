import type { PoolClient } from 'pg';

const HARVEST_INVENTORY_DDL = [
  `CREATE TABLE IF NOT EXISTS harvest_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_id TEXT NOT NULL,
    farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
    source_table TEXT,
    plot_local_id TEXT,
    plot_cloud_id UUID,
    subarea_local_id TEXT,
    subarea_cloud_id UUID,
    season_local_id TEXT,
    crop_local_id TEXT,
    crop_name TEXT,
    event_date TIMESTAMPTZ,
    net_weight_kg NUMERIC,
    area_ha NUMERIC,
    moisture_pct NUMERIC,
    notes TEXT,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT harvest_records_farm_local_unique UNIQUE (farm_id, local_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_harvest_records_farm_id ON harvest_records (farm_id)`,
  `CREATE TABLE IF NOT EXISTS inventory_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    local_id TEXT NOT NULL,
    farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
    source_table TEXT,
    plot_local_id TEXT,
    plot_cloud_id UUID,
    subarea_local_id TEXT,
    subarea_cloud_id UUID,
    product_name TEXT,
    batch_number TEXT,
    quantity NUMERIC,
    unit TEXT,
    transaction_type TEXT,
    notes TEXT,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT inventory_records_farm_local_unique UNIQUE (farm_id, local_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_inventory_records_farm_id ON inventory_records (farm_id)`,
];

export async function ensureHarvestInventoryTables(
  client: PoolClient,
): Promise<void> {
  for (let step = 0; step < HARVEST_INVENTORY_DDL.length; step++) {
    try {
      await client.query(HARVEST_INVENTORY_DDL[step]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(
        `[fortsmart-cloud-api] ensureHarvestInventoryTables step ${step + 1}: ${msg}`,
      );
    }
  }
}
