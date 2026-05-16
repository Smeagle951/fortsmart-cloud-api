import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { HttpError } from '../middleware/errorHandler.js';
import { displayKeyPrefix, getApiKeyPepper, hashRawApiKey } from '../utils/hashApiKey.js';

const PAIRING_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RATE_WINDOW_MS = 60 * 1000;

type RateBucket = {
  count: number;
  resetAt: number;
  blockedUntil: number;
};

const consumeRate = new Map<string, RateBucket>();

function hashSecret(raw: string): string {
  return crypto.createHash('sha256').update(`${raw.trim()}${getApiKeyPepper()}`, 'utf8').digest('hex');
}

function randomUrlToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}`;
}

function generateApiKey(): string {
  return `fs_live_empr_${crypto.randomBytes(32).toString('hex')}`;
}

function clientKey(ip?: string | null): string {
  return (ip || 'unknown').replace(/^::ffff:/, '');
}

function assertRateLimit(ip?: string | null): void {
  const key = clientKey(ip);
  const ts = Date.now();
  const current = consumeRate.get(key);
  if (current?.blockedUntil && current.blockedUntil > ts) {
    const seconds = Math.ceil((current.blockedUntil - ts) / 1000);
    throw new HttpError(`Muitas tentativas. Aguarde ${seconds}s antes de tentar novamente.`, 429);
  }
  if (!current || current.resetAt <= ts) {
    consumeRate.set(key, { count: 1, resetAt: ts + RATE_WINDOW_MS, blockedUntil: 0 });
    return;
  }
  current.count += 1;
  if (current.count > MAX_ATTEMPTS) {
    current.blockedUntil = ts + RATE_WINDOW_MS * Math.min(5, current.count - MAX_ATTEMPTS + 1);
    throw new HttpError('Muitas tentativas de pareamento. Aguarde antes de tentar novamente.', 429);
  }
}

async function logSecurityEvent(
  client: PoolClient,
  input: {
    farmId?: string | null;
    deviceId?: string | null;
    eventType: string;
    status: string;
    ip?: string | null;
    userAgent?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO security_events (farm_id, device_id, event_type, status, ip, user_agent, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      input.farmId ?? null,
      input.deviceId ?? null,
      input.eventType,
      input.status,
      input.ip ?? null,
      input.userAgent ?? null,
      JSON.stringify(input.details ?? {}),
    ],
  );
}

export async function createPairingSession(input: {
  apiKeyFarmId: string | null;
  farmCloudId: string;
  desktopInstallationId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{
  id: string;
  farm_cloud_id: string;
  farm_name: string;
  pairing_code: string;
  pairing_token: string;
  expires_at: string;
  api_url: string;
}> {
  if (!input.apiKeyFarmId) {
    throw new HttpError('API Key precisa estar vinculada a uma fazenda para gerar pareamento.', 403);
  }
  const farmCloudId = input.farmCloudId.trim();
  const desktopInstallationId = input.desktopInstallationId.trim();
  if (!farmCloudId) throw new HttpError('farm_cloud_id is required', 400);
  if (!desktopInstallationId) throw new HttpError('desktop_installation_id is required', 400);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const farmResult = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM farms
       WHERE id::text = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [farmCloudId],
    );
    const farm = farmResult.rows[0];
    if (!farm) throw new HttpError('Farm not found', 404);
    if (farm.id !== input.apiKeyFarmId) {
      throw new HttpError('farm_cloud_id does not match this API key', 403);
    }

    await client.query(
      `UPDATE pairing_sessions
       SET status = 'revoked', revoked_at = NOW()
       WHERE farm_id = $1 AND desktop_installation_id = $2 AND status = 'pending'`,
      [farm.id, desktopInstallationId],
    );

    const pairingCode = randomCode();
    const pairingToken = randomUrlToken();
    const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();
    const inserted = await client.query<{ id: string; expires_at: Date }>(
      `INSERT INTO pairing_sessions (
        farm_id, farm_cloud_id, desktop_installation_id,
        pairing_code_hash, pairing_token_hash, expires_at, ip
       )
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7)
       RETURNING id, expires_at`,
      [
        farm.id,
        farm.id,
        desktopInstallationId,
        hashSecret(pairingCode),
        hashSecret(pairingToken),
        expiresAt,
        input.ip ?? null,
      ],
    );
    await logSecurityEvent(client, {
      farmId: farm.id,
      eventType: 'pairing.created',
      status: 'success',
      ip: input.ip,
      userAgent: input.userAgent,
      details: { desktop_installation_id: desktopInstallationId },
    });
    await client.query('COMMIT');
    return {
      id: inserted.rows[0].id,
      farm_cloud_id: farm.id,
      farm_name: farm.name,
      pairing_code: pairingCode,
      pairing_token: pairingToken,
      expires_at: inserted.rows[0].expires_at.toISOString(),
      api_url: process.env.PUBLIC_API_URL || 'https://api.fortsmart-agro.com.br',
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function consumePairingSession(input: {
  pairingToken?: string;
  pairingCode?: string;
  deviceId: string;
  appVersion?: string | null;
  platform?: string | null;
  deviceName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{
  farm_cloud_id: string;
  farm_name: string;
  api_key: string;
  session_token: string;
  expires_at: string;
  permissions: string[];
}> {
  assertRateLimit(input.ip);
  const token = input.pairingToken?.trim() || '';
  const code = input.pairingCode?.trim().toUpperCase() || '';
  const deviceId = input.deviceId.trim();
  if (!token && !code) throw new HttpError('pairing_token or pairing_code is required', 400);
  if (!deviceId) throw new HttpError('device_id is required', 400);

  const tokenHash = token ? hashSecret(token) : null;
  const codeHash = code ? hashSecret(code) : null;
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE pairing_sessions
       SET status = 'expired'
       WHERE status = 'pending' AND expires_at <= NOW()`,
    );

    const found = await client.query<{
      id: string;
      farm_id: string;
      farm_cloud_id: string;
      status: string;
      expires_at: Date;
      consumed_at: Date | null;
      farm_name: string;
    }>(
      `SELECT ps.id, ps.farm_id, ps.farm_cloud_id, ps.status, ps.expires_at, ps.consumed_at, f.name AS farm_name
       FROM pairing_sessions ps
       JOIN farms f ON f.id = ps.farm_id
       WHERE ($1::text IS NOT NULL AND ps.pairing_token_hash = $1)
          OR ($2::text IS NOT NULL AND ps.pairing_code_hash = $2)
       FOR UPDATE`,
      [tokenHash, codeHash],
    );
    const session = found.rows[0];
    if (!session) {
      await logSecurityEvent(client, {
        deviceId,
        eventType: 'pairing.consume',
        status: 'invalid',
        ip: input.ip,
        userAgent: input.userAgent,
      });
      throw new HttpError('Pareamento inválido ou expirado.', 404);
    }
    if (session.status !== 'pending' || session.consumed_at) {
      await logSecurityEvent(client, {
        farmId: session.farm_id,
        deviceId,
        eventType: 'pairing.consume',
        status: 'reused',
        ip: input.ip,
        userAgent: input.userAgent,
        details: { pairing_session_id: session.id },
      });
      throw new HttpError('Este QR Code já foi usado ou revogado.', 409);
    }
    if (session.expires_at.getTime() <= Date.now()) {
      await client.query(`UPDATE pairing_sessions SET status = 'expired' WHERE id = $1`, [session.id]);
      await logSecurityEvent(client, {
        farmId: session.farm_id,
        deviceId,
        eventType: 'pairing.consume',
        status: 'expired',
        ip: input.ip,
        userAgent: input.userAgent,
        details: { pairing_session_id: session.id },
      });
      throw new HttpError('QR Code expirado. Gere uma nova conexão no desktop.', 410);
    }

    const rawApiKey = generateApiKey();
    const apiKeyHash = hashRawApiKey(rawApiKey);
    const sessionToken = randomUrlToken();
    const sessionTokenHash = hashSecret(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const insertedKey = await client.query<{ id: string }>(
      `INSERT INTO api_keys (farm_id, key_hash, key_prefix, name, is_active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id`,
      [session.farm_id, apiKeyHash, displayKeyPrefix(rawApiKey), `Mobile ${deviceId.slice(0, 16)}`],
    );

    await client.query(
      `INSERT INTO trusted_devices (
        device_id, farm_cloud_id, api_key_hash, session_token_hash,
        platform, app_version, device_name, last_seen_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (device_id, farm_cloud_id, api_key_hash) DO UPDATE SET
         session_token_hash = EXCLUDED.session_token_hash,
         platform = EXCLUDED.platform,
         app_version = EXCLUDED.app_version,
         device_name = EXCLUDED.device_name,
         last_seen_at = NOW(),
         revoked_at = NULL`,
      [
        deviceId,
        session.farm_id,
        apiKeyHash,
        sessionTokenHash,
        input.platform ?? null,
        input.appVersion ?? null,
        input.deviceName ?? null,
      ],
    );

    await client.query(
      `UPDATE pairing_sessions
       SET status = 'consumed',
           consumed_at = NOW(),
           consumed_by_device_id = $2,
           consumed_by_user_agent = $3
       WHERE id = $1`,
      [session.id, deviceId, input.userAgent ?? null],
    );
    await logSecurityEvent(client, {
      farmId: session.farm_id,
      deviceId,
      eventType: 'pairing.consume',
      status: 'success',
      ip: input.ip,
      userAgent: input.userAgent,
      details: { pairing_session_id: session.id, api_key_id: insertedKey.rows[0]?.id },
    });
    await client.query('COMMIT');
    return {
      farm_cloud_id: session.farm_id,
      farm_name: session.farm_name,
      api_key: rawApiKey,
      session_token: sessionToken,
      expires_at: expiresAt,
      permissions: ['base', 'planting', 'monitoring', 'inventory', 'reports'],
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPairingSessionStatus(input: {
  apiKeyFarmId: string | null;
  sessionId: string;
}): Promise<{ id: string; status: string; expires_at: string; consumed_at: string | null; consumed_by_device_id: string | null }> {
  if (!input.apiKeyFarmId) throw new HttpError('Unauthorized', 401);
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    status: string;
    expires_at: Date;
    consumed_at: Date | null;
    consumed_by_device_id: string | null;
  }>(
    `SELECT id,
       CASE WHEN status = 'pending' AND expires_at <= NOW() THEN 'expired' ELSE status END AS status,
       expires_at, consumed_at, consumed_by_device_id
     FROM pairing_sessions
     WHERE id = $1 AND farm_id = $2`,
    [input.sessionId, input.apiKeyFarmId],
  );
  const row = rows[0];
  if (!row) throw new HttpError('Pairing session not found', 404);
  return {
    id: row.id,
    status: row.status,
    expires_at: row.expires_at.toISOString(),
    consumed_at: row.consumed_at?.toISOString() ?? null,
    consumed_by_device_id: row.consumed_by_device_id,
  };
}

export async function revokePairingSession(input: {
  apiKeyFarmId: string | null;
  sessionId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  if (!input.apiKeyFarmId) throw new HttpError('Unauthorized', 401);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE pairing_sessions
       SET status = 'revoked', revoked_at = NOW()
       WHERE id = $1 AND farm_id = $2 AND status = 'pending'`,
      [input.sessionId, input.apiKeyFarmId],
    );
    if (result.rowCount === 0) throw new HttpError('Pairing session not found or not pending', 404);
    await logSecurityEvent(client, {
      farmId: input.apiKeyFarmId,
      eventType: 'pairing.revoked',
      status: 'success',
      ip: input.ip,
      userAgent: input.userAgent,
      details: { pairing_session_id: input.sessionId },
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listTrustedDevices(farmId: string | null): Promise<Array<Record<string, unknown>>> {
  if (!farmId) throw new HttpError('Unauthorized', 401);
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, device_id, farm_cloud_id, platform, app_version, device_name,
            created_at, last_seen_at, revoked_at
     FROM trusted_devices
     WHERE farm_cloud_id = $1
     ORDER BY created_at DESC`,
    [farmId],
  );
  return rows;
}

export async function revokeTrustedDevice(input: {
  apiKeyFarmId: string | null;
  deviceId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  if (!input.apiKeyFarmId) throw new HttpError('Unauthorized', 401);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE trusted_devices
       SET revoked_at = NOW()
       WHERE farm_cloud_id = $1 AND device_id = $2 AND revoked_at IS NULL`,
      [input.apiKeyFarmId, input.deviceId],
    );
    await logSecurityEvent(client, {
      farmId: input.apiKeyFarmId,
      deviceId: input.deviceId,
      eventType: 'device.revoked',
      status: 'success',
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function validateDeviceBinding(input: {
  apiKeyHash: string;
  farmId: string | null;
  deviceId?: string | null;
}): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ device_id: string; revoked_at: Date | null }>(
    `SELECT device_id, revoked_at
     FROM trusted_devices
     WHERE api_key_hash = $1
     LIMIT 1`,
    [input.apiKeyHash],
  );
  const trusted = rows[0];
  if (!trusted) return;
  if (trusted.revoked_at) throw new HttpError('Dispositivo revogado para esta chave.', 403);
  if (!input.deviceId?.trim()) throw new HttpError('device_id is required for paired API key', 401);
  if (trusted.device_id !== input.deviceId.trim()) {
    throw new HttpError('API Key vinculada a outro dispositivo. Faça novo pareamento.', 403);
  }
  await pool.query(
    `UPDATE trusted_devices SET last_seen_at = NOW()
     WHERE api_key_hash = $1 AND device_id = $2 AND ($3::uuid IS NULL OR farm_cloud_id = $3::uuid)`,
    [input.apiKeyHash, trusted.device_id, input.farmId],
  );
}
