-- Plantio: tabelas filhas + vínculos (idempotente). Executar no Neon se alguma tabela faltar.
-- Ordem: planting_records primeiro (FKs dos filhos apontam para ela).

CREATE TABLE IF NOT EXISTS planting_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  plot_local_id TEXT,
  plot_cloud_id UUID,
  subarea_local_id TEXT,
  subarea_cloud_id UUID,
  deleted_at TIMESTAMPTZ,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT planting_records_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE TABLE IF NOT EXISTS plant_stand_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  planting_record_id UUID REFERENCES planting_records (id) ON DELETE CASCADE,
  planting_local_id TEXT,
  plot_local_id TEXT,
  plot_cloud_id UUID,
  subarea_local_id TEXT,
  subarea_cloud_id UUID,
  deleted_at TIMESTAMPTZ,
  evaluation_date TIMESTAMPTZ,
  emergence_date DATE,
  phenological_stage TEXT,
  plants_counted NUMERIC,
  meters_evaluated NUMERIC,
  plants_per_meter NUMERIC,
  plants_per_hectare NUMERIC,
  ideal_population NUMERIC,
  efficiency NUMERIC,
  observations TEXT,
  photos JSONB,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT plant_stand_records_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE TABLE IF NOT EXISTS planting_cv_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  planting_record_id UUID REFERENCES planting_records (id) ON DELETE CASCADE,
  planting_local_id TEXT,
  plot_local_id TEXT,
  plot_cloud_id UUID,
  subarea_local_id TEXT,
  subarea_cloud_id UUID,
  deleted_at TIMESTAMPTZ,
  cv_percent NUMERIC,
  stand_cv_percent NUMERIC,
  spacing_between_seeds NUMERIC,
  average_spacing NUMERIC,
  standard_deviation NUMERIC,
  failures_count NUMERIC,
  doubles_count NUMERIC,
  triples_count NUMERIC,
  failure_percent NUMERIC,
  doubles_percent NUMERIC,
  triples_percent NUMERIC,
  estimated_population NUMERIC,
  classification TEXT,
  comparison_status_population TEXT,
  comparison_status_plants_meter TEXT,
  detailed_metrics JSONB,
  calculation_details JSONB,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT planting_cv_records_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE TABLE IF NOT EXISTS planting_calibration_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  planting_record_id UUID REFERENCES planting_records (id) ON DELETE CASCADE,
  planting_local_id TEXT,
  plot_local_id TEXT,
  plot_cloud_id UUID,
  subarea_local_id TEXT,
  subarea_cloud_id UUID,
  deleted_at TIMESTAMPTZ,
  calibration_date TIMESTAMPTZ,
  seeds_per_meter NUMERIC,
  seeds_per_hectare NUMERIC,
  target_seeds_hectare NUMERIC,
  spacing_cm NUMERIC,
  distance_measured NUMERIC,
  transmission_ratio NUMERIC,
  gear_drive TEXT,
  gear_driven TEXT,
  calibration_status TEXT,
  notes TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT planting_calibration_records_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE TABLE IF NOT EXISTS planting_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  planting_record_id UUID REFERENCES planting_records (id) ON DELETE CASCADE,
  planting_local_id TEXT,
  file_name TEXT,
  local_path TEXT,
  cloud_url TEXT,
  cloud_storage_key TEXT,
  cloud_expires_at TIMESTAMPTZ,
  caption TEXT,
  taken_at TIMESTAMPTZ,
  latitude NUMERIC,
  longitude NUMERIC,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT planting_images_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE TABLE IF NOT EXISTS phenology_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  plot_local_id TEXT,
  plot_cloud_id UUID,
  subarea_local_id TEXT,
  subarea_cloud_id UUID,
  crop_local_id TEXT,
  crop_cloud_id UUID,
  deleted_at TIMESTAMPTZ,
  evaluation_date TIMESTAMPTZ,
  stage TEXT,
  description TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  photos JSONB,
  notes TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT phenology_records_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE TABLE IF NOT EXISTS geo_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  plot_local_id TEXT,
  plot_cloud_id UUID,
  subarea_local_id TEXT,
  subarea_cloud_id UUID,
  deleted_at TIMESTAMPTZ,
  type TEXT,
  file_name TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  geojson JSONB,
  kml_text TEXT,
  notes TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT geo_exports_farm_local_unique UNIQUE (farm_id, local_id)
);

ALTER TABLE phenology_records ADD COLUMN IF NOT EXISTS planting_record_id UUID REFERENCES planting_records (id) ON DELETE SET NULL;
ALTER TABLE phenology_records ADD COLUMN IF NOT EXISTS planting_local_id TEXT;
ALTER TABLE phenology_records ADD COLUMN IF NOT EXISTS dae INTEGER;
ALTER TABLE phenology_records ADD COLUMN IF NOT EXISTS dap INTEGER;
ALTER TABLE geo_exports ADD COLUMN IF NOT EXISTS planting_record_id UUID REFERENCES planting_records (id) ON DELETE SET NULL;
ALTER TABLE geo_exports ADD COLUMN IF NOT EXISTS planting_local_id TEXT;
