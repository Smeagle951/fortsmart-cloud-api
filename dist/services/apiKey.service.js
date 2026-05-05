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
/** Documentação: use o mesmo pepper do servidor ao gerar key_hash para INSERT. */
export function hashKeyForInsert(rawKey) {
    return {
        key_hash: hashRawApiKey(rawKey),
        key_prefix: displayKeyPrefix(rawKey),
    };
}
//# sourceMappingURL=apiKey.service.js.map