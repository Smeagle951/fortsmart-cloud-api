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

CREATE INDEX IF NOT EXISTS idx_monitoring_occurrences_farm_id
  ON monitoring_occurrences (farm_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_occurrences_report_id
  ON monitoring_occurrences (monitoring_report_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_occurrences_point_id
  ON monitoring_occurrences (monitoring_point_id);

CREATE TABLE IF NOT EXISTS monitoring_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id TEXT NOT NULL,
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  monitoring_occurrence_id UUID REFERENCES monitoring_occurrences (id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_monitoring_recommendations_occurrence_id
  ON monitoring_recommendations (monitoring_occurrence_id);

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

CREATE INDEX IF NOT EXISTS idx_monitoring_images_occurrence_id
  ON monitoring_images (occurrence_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_images_point_id
  ON monitoring_images (monitoring_point_id);
