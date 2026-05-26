import { HttpError } from '../middleware/errorHandler.js';
function asRecord(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function optionalIso(value) {
    if (value == null || value === '')
        return null;
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
function numberField(root, key) {
    const n = Number(root[key] ?? 0);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
}
export async function pushMonitoringSync(pool, apiKeyId, body) {
    const schemaVersion = String(body.schema_version ?? '').trim();
    if (schemaVersion !== 'monitoring.sync.v1') {
        throw new HttpError('schema_version inválido para monitoramento', 400);
    }
    if (!Array.isArray(body.sessions)) {
        throw new HttpError('sessions precisa ser uma lista', 400);
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: keyRows } = await client.query(`SELECT farm_id FROM api_keys WHERE id = $1 FOR UPDATE`, [apiKeyId]);
        const farmId = keyRows[0]?.farm_id;
        if (!farmId) {
            throw new HttpError('Faça primeiro a sincronização base para vincular a fazenda.', 403);
        }
        const summary = asRecord(body.summary);
        const syncedAt = new Date().toISOString();
        const { rows } = await client.query(`INSERT INTO monitoring_payloads (
         farm_id, device_id, schema_version, payload,
         sessions_count, points_count, occurrences_count, photos_count,
         generated_at, synced_at
       )
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::timestamptz, $10::timestamptz)
       RETURNING id`, [
            farmId,
            typeof body.device_id === 'string' ? body.device_id : null,
            schemaVersion,
            JSON.stringify(body),
            numberField(summary, 'sessions'),
            numberField(summary, 'points'),
            numberField(summary, 'occurrences'),
            numberField(summary, 'photos'),
            optionalIso(body.generated_at),
            syncedAt,
        ]);
        await client.query(`INSERT INTO sync_logs (farm_id, module, entity, cloud_id, action, status, device_id)
       VALUES ($1, 'monitoring', 'payload', $2, 'push', 'ok', $3)`, [farmId, rows[0]?.id ?? null, typeof body.device_id === 'string' ? body.device_id : null]);
        await client.query('COMMIT');
        return { payload_id: rows[0].id, synced_at: syncedAt };
    }
    catch (e) {
        await client.query('ROLLBACK');
        throw e;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=monitoringSync.service.js.map