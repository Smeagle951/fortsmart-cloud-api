-- Decision Engine insights (mobile push → desktop pull)

CREATE TABLE IF NOT EXISTS decision_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_cloud_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  farm_local_id TEXT,
  local_id TEXT NOT NULL,
  talhao_local_id TEXT,
  talhao_cloud_id TEXT,
  safra_id TEXT,
  culture_id TEXT,
  organism_id TEXT,
  source_module TEXT,
  source_table TEXT,
  source_id TEXT,
  monitoring_session_id TEXT,
  monitoring_occurrence_id TEXT,
  monitoring_point_id TEXT,
  prescription_id TEXT,
  risk_level TEXT,
  risk_score NUMERIC,
  estimated_loss_sc_ha NUMERIC,
  estimated_loss_brl_ha NUMERIC,
  estimated_total_loss_brl NUMERIC,
  action_window_hours NUMERIC,
  recommendation TEXT,
  confidence_percent NUMERIC,
  evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_engine_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  economic_analysis_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT decision_insights_farm_local_unique UNIQUE (farm_cloud_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_decision_insights_farm
  ON decision_insights (farm_cloud_id);

CREATE INDEX IF NOT EXISTS idx_decision_insights_talhao_local
  ON decision_insights (farm_cloud_id, talhao_local_id);

CREATE INDEX IF NOT EXISTS idx_decision_insights_talhao_cloud
  ON decision_insights (farm_cloud_id, talhao_cloud_id);

CREATE INDEX IF NOT EXISTS idx_decision_insights_risk
  ON decision_insights (farm_cloud_id, risk_level, risk_score DESC);
