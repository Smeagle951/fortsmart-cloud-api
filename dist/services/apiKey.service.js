import { getPool } from '../db/pool.js';
import { HttpError } from '../middleware/errorHandler.js';
import { displayKeyPrefix, hashRawApiKey } from '../utils/hashApiKey.js';
export const DEFAULT_MODULES = ['base', 'planting', 'monitoring', 'inventory', 'reports'];
function parseBearer(authorization) {
    if (!authorization?.startsWith('Bearer ')) {
        throw new HttpError('Missing or invalid Authorization header', 401);
    }
    const raw = authorization.slice('Bearer '.length).trim();
    if (!raw) {
        throw new HttpError('Empty Bearer token', 401);
    }
    return raw;
}
export async function findActiveByRawKey(rawKey) {
    const hash = hashRawApiKey(rawKey);
    const pool = getPool();
    const { rows } = await pool.query(`SELECT id, farm_id, key_hash, key_prefix, is_active
     FROM api_keys
     WHERE key_hash = $1 AND is_active = true
     LIMIT 1`, [hash]);
    return rows[0] ?? null;
}
export async function authenticateBearer(authorization) {
    const raw = parseBearer(authorization);
    const row = await findActiveByRawKey(raw);
    if (!row) {
        throw new HttpError('Invalid or inactive API key', 401);
    }
    return row;
}
export async function touchLastUsed(apiKeyId, client) {
    const q = `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`;
    if (client) {
        await client.query(q, [apiKeyId]);
        return;
    }
    const pool = getPool();
    await pool.query(q, [apiKeyId]);
}
export async function regenerateRawApiKeyForFarm(input) {
    const rawKey = input.rawKey.trim();
    const farmIdOrCloudId = input.farmIdOrCloudId?.trim() || '';
    if (!rawKey.startsWith('fs_live_')) {
        throw new HttpError('API Key deve iniciar com fs_live_.', 400);
    }
    const pool = getPool();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let linkedFarmId = null;
        if (farmIdOrCloudId) {
            const farm = await client.query(`SELECT id FROM farms
         WHERE (id::text = $1 OR local_id = $1) AND deleted_at IS NULL
         LIMIT 1`, [farmIdOrCloudId]);
            linkedFarmId = farm.rows[0]?.id ?? null;
        }
        if (linkedFarmId) {
            await client.query(`UPDATE api_keys
         SET is_active = false
         WHERE farm_id = $1 AND is_active = true`, [linkedFarmId]);
        }
        const keyHash = hashRawApiKey(rawKey);
        const keyPrefix = displayKeyPrefix(rawKey);
        const inserted = await client.query(`INSERT INTO api_keys (farm_id, key_hash, key_prefix, name, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (key_hash) DO UPDATE SET
        farm_id = COALESCE(EXCLUDED.farm_id, api_keys.farm_id),
        key_prefix = EXCLUDED.key_prefix,
        name = COALESCE(EXCLUDED.name, api_keys.name),
        is_active = true
       RETURNING id, farm_id, key_prefix, created_at`, [linkedFarmId, keyHash, keyPrefix, input.name?.trim() || 'FortSmart Desktop Sync']);
        await client.query('COMMIT');
        const row = inserted.rows[0];
        return {
            key_id: row.id,
            farm_id: row.farm_id,
            key_prefix: row.key_prefix,
            created_at: row.created_at.toISOString(),
        };
    }
    catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    }
    finally {
        client.release();
    }
}
/** Documentação: use o mesmo pepper do servidor ao gerar key_hash para INSERT. */
export function hashKeyForInsert(rawKey) {
    return {
        key_hash: hashRawApiKey(rawKey),
        key_prefix: displayKeyPrefix(rawKey),
    };
}
//# sourceMappingURL=apiKey.service.js.map