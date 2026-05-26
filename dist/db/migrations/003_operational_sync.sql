CREATE TABLE IF NOT EXISTS monitoring_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  plot_local_id TEXT,
  plot_cloud_id UUID,
  subarea_local_id TEXT,
  subarea_cloud_id UUID,
  season_local_id TEXT,
  crop_local_id TEXT,
  report_date TIMESTAMPTZ,
  phenological_stage TEXT,
  technician_name TEXT,
  observations TEXT,
  status TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monitoring_reports_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_monitoring_reports_farm_id ON monitoring_reports (farm_id);

CREATE TABLE IF NOT EXISTS monitoring_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  monitoring_report_id UUID REFERENCES monitoring_reports (id) ON DELETE CASCADE,
  latitude NUMERIC,
  longitude NUMERIC,
  notes TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monitoring_points_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE TABLE IF NOT EXISTS monitoring_pests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  monitoring_report_id UUID REFERENCES monitoring_reports (id) ON DELETE CASCADE,
  name TEXT,
  severity TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monitoring_pests_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE TABLE IF NOT EXISTS monitoring_diseases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  monitoring_report_id UUID REFERENCES monitoring_reports (id) ON DELETE CASCADE,
  name TEXT,
  severity TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monitoring_diseases_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE TABLE IF NOT EXISTS monitoring_weeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  monitoring_report_id UUID REFERENCES monitoring_reports (id) ON DELETE CASCADE,
  name TEXT,
  severity TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monitoring_weeds_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_monitoring_points_farm_id ON monitoring_points (farm_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_pests_farm_id ON monitoring_pests (farm_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_diseases_farm_id ON monitoring_diseases (farm_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_weeds_farm_id ON monitoring_weeds (farm_id);

CREATE TABLE IF NOT EXISTS planting_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  plot_local_id TEXT,
  plot_cloud_id UUID,
  subarea_local_id TEXT,
  subarea_cloud_id UUID,
  season_local_id TEXT,
  season_cloud_id UUID,
  crop_local_id TEXT,
  crop_cloud_id UUID,
  variety_name TEXT,
  planting_date DATE,
  spacing_m NUMERIC,
  planned_population NUMERIC,
  real_population NUMERIC,
  area_ha NUMERIC,
  notes TEXT,
  status TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT planting_records_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_planting_records_farm_id ON planting_records (farm_id);

CREATE TABLE IF NOT EXISTS plant_stand_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  plot_local_id TEXT,
  plot_cloud_id UUID,
  subarea_local_id TEXT,
  subarea_cloud_id UUID,
  evaluation_date TIMESTAMPTZ,
  plants_counted NUMERIC,
  meters_evaluated NUMERIC,
  estimated_population NUMERIC,
  failures_count NUMERIC,
  latitude NUMERIC,
  longitude NUMERIC,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT plant_stand_records_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_plant_stand_records_farm_id ON plant_stand_records (farm_id);

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
  evaluation_date TIMESTAMPTZ,
  stage TEXT,
  description TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT phenology_records_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_phenology_records_farm_id ON phenology_records (farm_id);

CREATE TABLE IF NOT EXISTS geo_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  plot_local_id TEXT,
  plot_cloud_id UUID,
  subarea_local_id TEXT,
  subarea_cloud_id UUID,
  type TEXT,
  file_name TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  geojson JSONB,
  kml_text TEXT,
  notes TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT geo_exports_farm_local_unique UNIQUE (farm_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_geo_exports_farm_id ON geo_exports (farm_id);
