import { HttpError } from '../middleware/errorHandler.js';
import { upsertDecisionInsight, } from '../repositories/decisionInsightsSync.repository.js';
import { normalizePushItem, parseDecisionInsightsPushBody, } from '../validators/decisionInsightsSync.validator.js';
async function validateFarmLink(client, apiKeyId, body) {
    const { rows: keyRows } = await client.query(`SELECT farm_id FROM api_keys WHERE id = $1 FOR UPDATE`, [apiKeyId]);
    const linkedFarmId = keyRows[0]?.farm_id ?? null;
    if (!linkedFarmId) {
        throw new HttpError('Faça primeiro a sincronização base para vincular a fazenda.', 403);
    }
    if (linkedFarmId.toLowerCase() !== body.farm_cloud_id.toLowerCase()) {
        throw new HttpError('farm_cloud_id does not match the farm linked to this API key', 403);
    }
    return linkedFarmId;
}
export async function pushDecisionInsightsSync(pool, apiKeyId, rawBody) {
    const body = parseDecisionInsightsPushBody(rawBody);
    const client = await pool.connect();
    const counters = {
        inserted: 0,
        updated: 0,
        skipped: 0,
    };
    try {
        await client.query('BEGIN');
        const farmCloudId = await validateFarmLink(client, apiKeyId, body);
        for (const rawItem of body.items) {
            const normalized = normalizePushItem(rawItem);
            const result = await upsertDecisionInsight(client, farmCloudId, body.farm_local_id, normalized);
            counters[result]++;
        }
        await client.query('COMMIT');
        const syncedAt = new Date().toISOString();
        return {
            farm_cloud_id: farmCloudId,
            received: body.items.length,
            inserted: counters.inserted,
            updated: counters.updated,
            skipped: counters.skipped,
            synced_at: syncedAt,
        };
    }
    catch (e) {
        await client.query('ROLLBACK');
        throw e;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=decisionInsightsSync.service.js.map