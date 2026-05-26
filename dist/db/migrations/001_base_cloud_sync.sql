-- FortSmart Cloud — schema base (Neon / PostgreSQL 13+)
-- gen_random_uuid() é nativo no PG 13+; não é necessário CREATE EXTENSION pgcrypto
-- (evita NOTICE "extension ... already exists" no Neon quando pgcrypto já está ativo).

CREATE TABLE IF NOT EXISTS farms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_name TEXT,
  city TEXT,
  state TEXT,
  total_area_ha NUMERIC,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT farms_local_id_unique UNIQUE (local_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID REFERENCES farms (id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  key_prefix TEXT,
  name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  CONSTRAINT api_keys_key_hash_unique UNIQUE (key_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_farm_id ON api_keys (farm_id);
CREATE INDEX IF NOT EXISTS idx_farms_local_id ON farms (local_id);

CREATE TABLE IF NOT EXISTS seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  local_id TEXT NOT NULL,
  name TEXT NOT NULL,
  crop_name TEXT,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT seasons_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE TABLE IF NOT EXISTS crops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  local_id TEXT NOT NULL,
  name TEXT NOT NULL,
  scientific_name TEXT,
  family TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crops_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE TABLE IF NOT EXISTS plots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  local_id TEXT NOT NULL,
  name TEXT NOT NULL,
  area_ha NUMERIC,
  perimeter_m NUMERIC,
  centroid_lat NUMERIC,
  centroid_lng NUMERIC,
  geojson JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT plots_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_plots_farm_id ON plots (farm_id);

CREATE TABLE IF NOT EXISTS subareas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  plot_id UUID NOT NULL REFERENCES plots (id) ON DELETE CASCADE,
  local_id TEXT NOT NULL,
  plot_local_id TEXT,
  name TEXT NOT NULL,
  treatment_name TEXT,
  area_ha NUMERIC,
  centroid_lat NUMERIC,
  centroid_lng NUMERIC,
  geojson JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT subareas_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_subareas_farm_id ON subareas (farm_id);
CREATE INDEX IF NOT EXISTS idx_subareas_plot_id ON subareas (plot_id);

CREATE TABLE IF NOT EXISTS sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID REFERENCES farms (id) ON DELETE SET NULL,
  module TEXT NOT NULL,
  entity TEXT,
  local_id TEXT,
  cloud_id UUID,
  action TEXT,
  status TEXT,
  error_message TEXT,
  device_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_farm_id ON sync_logs (farm_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_created_at ON sync_logs (created_at);
