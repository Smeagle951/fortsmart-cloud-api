CREATE TABLE IF NOT EXISTS pairing_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  farm_cloud_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  desktop_installation_id TEXT NOT NULL,
  pairing_code_hash TEXT NOT NULL,
  pairing_token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_device_id TEXT,
  consumed_by_user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  ip TEXT,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT pairing_sessions_status_check CHECK (status IN ('pending', 'consumed', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_pairing_sessions_farm_status
  ON pairing_sessions (farm_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_pairing_sessions_code_hash
  ON pairing_sessions (pairing_code_hash);

CREATE TABLE IF NOT EXISTS trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL,
  farm_cloud_id UUID NOT NULL REFERENCES farms (id) ON DELETE CASCADE,
  api_key_hash TEXT NOT NULL REFERENCES api_keys (key_hash) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  platform TEXT,
  app_version TEXT,
  device_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT trusted_devices_unique_active UNIQUE (device_id, farm_cloud_id, api_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_api_key_hash
  ON trusted_devices (api_key_hash);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_farm
  ON trusted_devices (farm_cloud_id, revoked_at);

CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id UUID REFERENCES farms (id) ON DELETE SET NULL,
  device_id TEXT,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_created
  ON security_events (created_at DESC);
