-- Monitoring Report V2: colunas JSONB incrementais (compatível com v1).
ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS schema_version TEXT;
ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS plot_geojson JSONB;
ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS organisms_detected JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS recommendations JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS integrated_management JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS economic_impacts JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS stand_context JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS environment_context JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS planting_context JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE monitoring_reports ADD COLUMN IF NOT EXISTS dashboard_summary JSONB NOT NULL DEFAULT '{}'::jsonb;
