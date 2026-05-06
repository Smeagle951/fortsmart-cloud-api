CREATE TABLE IF NOT EXISTS monitoring_payloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  device_id TEXT,
  schema_version TEXT NOT NULL,
  payload JSONB NOT NULL,
  sessions_count INTEGER NOT NULL DEFAULT 0,
  points_count INTEGER NOT NULL DEFAULT 0,
  occurrences_count INTEGER NOT NULL DEFAULT 0,
  photos_count INTEGER NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitoring_payloads_farm_id
  ON monitoring_payloads (farm_id);

CREATE INDEX IF NOT EXISTS idx_monitoring_payloads_synced_at
  ON monitoring_payloads (synced_at DESC);
