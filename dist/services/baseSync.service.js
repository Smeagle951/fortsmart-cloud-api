import { HttpError } from '../middleware/errorHandler.js';
import { tryNormalizeGeojson } from '../utils/normalizeGeojson.js';
function optionalIsoTimestamp(s) {
    if (!s)
        return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function parseDateOnly(v) {
    if (v == null || v === '')
        return null;
    const d = new Date(String(v).trim());
    if (Number.isNaN(d.getTime()))
        return null;
    return d.toISOString().slice(0, 10);
}
function optionalStrField(v) {
    if (v == null)
        return null;
    const s = String(v).trim();
    return s === '' ? null : s;
}
async function logSync(client, farmId, opts) {
    await client.query(`INSERT INTO sync_logs (farm_id, module, entity, local_id, cloud_id, action, status, error_message, device_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
        farmId,
        opts.module,
        opts.entity ?? null,
        opts.local_id ?? null,
        opts.cloud_id ?? null,
        opts.action ?? null,
        opts.status,
        opts.error_message ?? null,
        opts.device_id ?? null,
    ]);
}
export async function pushBaseSync(pool, apiKeyId, body, dryRun) {
    const mapping = {
        farms: {},
        plots: {},
        subareas: {},
        seasons: {},
        crops: {},
    };
    const synced_at = new Date().toISOString();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows: keyRows } = await client.query(`SELECT farm_id FROM api_keys WHERE id = $1 FOR UPDATE`, [apiKeyId]);
        const lockedFarmId = keyRows[0]?.farm_id ?? null;
        const f = body.farm;
        const farmDeletedAt = optionalIsoTimestamp(f.deleted_at);
        const farmUpdatedAt = optionalIsoTimestamp(f.updated_at) ?? synced_at;
        const { rows: farmUpsert } = await client.query(`INSERT INTO farms (local_id, name, owner_name, city, state, total_area_ha, updated_at, deleted_at, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9)
       ON CONFLICT (local_id) DO UPDATE SET
         name = EXCLUDED.name,
         owner_name = EXCLUDED.owner_name,
         city = EXCLUDED.city,
         state = EXCLUDED.state,
         total_area_ha = EXCLUDED.total_area_ha,
         updated_at = EXCLUDED.updated_at,
         deleted_at = EXCLUDED.deleted_at,
         is_active = EXCLUDED.is_active
       RETURNING id, local_id`, [
            f.local_id,
            f.name,
            f.owner_name,
            f.city,
            f.state,
            f.total_area_ha,
            farmUpdatedAt,
            farmDeletedAt,
            farmDeletedAt == null,
        ]);
        const farmRow = farmUpsert[0];
        if (!farmRow) {
            throw new HttpError('Failed to upsert farm', 500);
        }
        const farmId = farmRow.id;
        mapping.farms[f.local_id] = farmId;
        if (lockedFarmId === null) {
            const link = await client.query(`UPDATE api_keys SET farm_id = $1 WHERE id = $2 AND farm_id IS NULL`, [
                farmId,
                apiKeyId,
            ]);
            if (link.rowCount === 0) {
                const { rows: again } = await client.query(`SELECT farm_id FROM api_keys WHERE id = $1`, [apiKeyId]);
                const nowFid = again[0]?.farm_id;
                if (nowFid !== farmId) {
                    throw new HttpError('API key is already linked to another farm', 403);
                }
            }
        }
        else {
            if (lockedFarmId !== farmId) {
                throw new HttpError('farm_local_id does not match the farm linked to this API key', 403);
            }
        }
        const plotLocalToId = new Map();
        for (const raw of body.plots) {
            const o = raw;
            const localId = typeof o.local_id === 'string' ? o.local_id.trim() : '';
            const name = typeof o.name === 'string' ? o.name : '';
            if (!localId) {
                await logSync(client, farmId, {
                    module: 'base',
                    entity: 'plot',
                    status: 'error',
                    error_message: 'missing local_id',
                    device_id: body.device_id,
                });
                continue;
            }
            const gj = tryNormalizeGeojson(o.geojson);
            if (!gj) {
                await logSync(client, farmId, {
                    module: 'base',
                    entity: 'plot',
                    local_id: localId,
                    status: 'error',
                    error_message: 'invalid geojson',
                    device_id: body.device_id,
                });
                continue;
            }
            const area = o.area_ha == null ? null : Number(o.area_ha);
            const perimeter = o.perimeter_m == null ? null : Number(o.perimeter_m);
            const cLat = o.centroid_lat == null ? null : Number(o.centroid_lat);
            const cLng = o.centroid_lng == null ? null : Number(o.centroid_lng);
            const perimeterVal = perimeter != null && Number.isFinite(perimeter) ? perimeter : null;
            const updatedAt = optionalIsoTimestamp(typeof o.updated_at === 'string' ? o.updated_at : null) ?? synced_at;
            const delAt = optionalIsoTimestamp(typeof o.deleted_at === 'string' ? o.deleted_at : null);
            const { rows } = await client.query(`INSERT INTO plots (farm_id, local_id, name, area_ha, perimeter_m, centroid_lat, centroid_lng, geojson, updated_at, deleted_at, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz, $10::timestamptz, $11)
         ON CONFLICT (farm_id, local_id) DO UPDATE SET
           name = EXCLUDED.name,
           area_ha = EXCLUDED.area_ha,
           perimeter_m = EXCLUDED.perimeter_m,
           centroid_lat = EXCLUDED.centroid_lat,
           centroid_lng = EXCLUDED.centroid_lng,
           geojson = EXCLUDED.geojson,
           updated_at = EXCLUDED.updated_at,
           deleted_at = EXCLUDED.deleted_at,
           is_active = EXCLUDED.is_active
         RETURNING id`, [
                farmId,
                localId,
                name || localId,
                area != null && Number.isFinite(area) ? area : null,
                perimeterVal,
                cLat != null && Number.isFinite(cLat) ? cLat : null,
                cLng != null && Number.isFinite(cLng) ? cLng : null,
                JSON.stringify(gj),
                updatedAt,
                delAt,
                delAt == null,
            ]);
            const pid = rows[0]?.id;
            if (pid) {
                plotLocalToId.set(localId, pid);
                mapping.plots[localId] = pid;
            }
        }
        for (const raw of body.seasons) {
            const o = raw;
            const localId = typeof o.local_id === 'string' && o.local_id.trim() !== '' ? o.local_id.trim() : '';
            if (!localId) {
                await logSync(client, farmId, {
                    module: 'base',
                    entity: 'season',
                    status: 'error',
                    error_message: 'missing local_id',
                    device_id: body.device_id,
                });
                continue;
            }
            const seasonName = typeof o.name === 'string' ? o.name : '';
            const cropName = optionalStrField(o.crop_name);
            const startD = parseDateOnly(o.start_date);
            const endD = parseDateOnly(o.end_date);
            const updatedAt = optionalIsoTimestamp(typeof o.updated_at === 'string' ? o.updated_at : null) ?? synced_at;
            const delAt = optionalIsoTimestamp(typeof o.deleted_at === 'string' ? o.deleted_at : null);
            const { rows } = await client.query(`INSERT INTO seasons (farm_id, local_id, name, crop_name, start_date, end_date, updated_at, deleted_at, is_active)
         VALUES ($1, $2, $3, $4, $5::date, $6::date, $7::timestamptz, $8::timestamptz, $9)
         ON CONFLICT (farm_id, local_id) DO UPDATE SET
           name = EXCLUDED.name,
           crop_name = EXCLUDED.crop_name,
           start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date,
           updated_at = EXCLUDED.updated_at,
           deleted_at = EXCLUDED.deleted_at,
           is_active = EXCLUDED.is_active
         RETURNING id`, [farmId, localId, seasonName || localId, cropName, startD, endD, updatedAt, delAt, delAt == null]);
            const sid = rows[0]?.id;
            if (sid)
                mapping.seasons[localId] = sid;
        }
        for (const raw of body.crops) {
            const o = raw;
            const localId = typeof o.local_id === 'string' && o.local_id.trim() !== '' ? o.local_id.trim() : '';
            if (!localId) {
                await logSync(client, farmId, {
                    module: 'base',
                    entity: 'crop',
                    status: 'error',
                    error_message: 'missing local_id',
                    device_id: body.device_id,
                });
                continue;
            }
            const cropName = typeof o.name === 'string' ? o.name : '';
            const sci = optionalStrField(o.scientific_name);
            const fam = optionalStrField(o.family);
            const desc = optionalStrField(o.description);
            const updatedAt = optionalIsoTimestamp(typeof o.updated_at === 'string' ? o.updated_at : null) ?? synced_at;
            const delAt = optionalIsoTimestamp(typeof o.deleted_at === 'string' ? o.deleted_at : null);
            const { rows } = await client.query(`INSERT INTO crops (farm_id, local_id, name, scientific_name, family, description, updated_at, deleted_at, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9)
         ON CONFLICT (farm_id, local_id) DO UPDATE SET
           name = EXCLUDED.name,
           scientific_name = EXCLUDED.scientific_name,
           family = EXCLUDED.family,
           description = EXCLUDED.description,
           updated_at = EXCLUDED.updated_at,
           deleted_at = EXCLUDED.deleted_at,
           is_active = EXCLUDED.is_active
         RETURNING id`, [farmId, localId, cropName || localId, sci, fam, desc, updatedAt, delAt, delAt == null]);
            const cid = rows[0]?.id;
            if (cid)
                mapping.crops[localId] = cid;
        }
        for (const raw of body.subareas) {
            const o = raw;
            const localId = typeof o.local_id === 'string' ? o.local_id.trim() : '';
            const plotLocal = typeof o.plot_local_id === 'string'
                ? o.plot_local_id.trim()
                : typeof o.plot_local_id === 'number'
                    ? String(o.plot_local_id)
                    : '';
            if (!localId || !plotLocal) {
                await logSync(client, farmId, {
                    module: 'base',
                    entity: 'subarea',
                    local_id: localId || undefined,
                    status: 'error',
                    error_message: 'missing local_id or plot_local_id',
                    device_id: body.device_id,
                });
                continue;
            }
            const plotId = plotLocalToId.get(plotLocal);
            if (!plotId) {
                await logSync(client, farmId, {
                    module: 'base',
                    entity: 'subarea',
                    local_id: localId,
                    status: 'error',
                    error_message: `plot_local_id not found: ${plotLocal}`,
                    device_id: body.device_id,
                });
                continue;
            }
            const gj = tryNormalizeGeojson(o.geojson);
            if (!gj) {
                await logSync(client, farmId, {
                    module: 'base',
                    entity: 'subarea',
                    local_id: localId,
                    status: 'error',
                    error_message: 'invalid geojson',
                    device_id: body.device_id,
                });
                continue;
            }
            const subName = typeof o.name === 'string' ? o.name : '';
            const treatment = optionalStrField(o.treatment_name);
            const area = o.area_ha == null ? null : Number(o.area_ha);
            const cLat = o.centroid_lat == null ? null : Number(o.centroid_lat);
            const cLng = o.centroid_lng == null ? null : Number(o.centroid_lng);
            const updatedAt = optionalIsoTimestamp(typeof o.updated_at === 'string' ? o.updated_at : null) ?? synced_at;
            const delAt = optionalIsoTimestamp(typeof o.deleted_at === 'string' ? o.deleted_at : null);
            const { rows } = await client.query(`INSERT INTO subareas (farm_id, plot_id, local_id, plot_local_id, name, treatment_name, area_ha, centroid_lat, centroid_lng, geojson, updated_at, deleted_at, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz, $12::timestamptz, $13)
         ON CONFLICT (farm_id, local_id) DO UPDATE SET
           plot_id = EXCLUDED.plot_id,
           plot_local_id = EXCLUDED.plot_local_id,
           name = EXCLUDED.name,
           treatment_name = EXCLUDED.treatment_name,
           area_ha = EXCLUDED.area_ha,
           centroid_lat = EXCLUDED.centroid_lat,
           centroid_lng = EXCLUDED.centroid_lng,
           geojson = EXCLUDED.geojson,
           updated_at = EXCLUDED.updated_at,
           deleted_at = EXCLUDED.deleted_at,
           is_active = EXCLUDED.is_active
         RETURNING id`, [
                farmId,
                plotId,
                localId,
                plotLocal,
                subName || localId,
                treatment,
                area != null && Number.isFinite(area) ? area : null,
                cLat != null && Number.isFinite(cLat) ? cLat : null,
                cLng != null && Number.isFinite(cLng) ? cLng : null,
                JSON.stringify(gj),
                updatedAt,
                delAt,
                delAt == null,
            ]);
            const sid = rows[0]?.id;
            if (sid)
                mapping.subareas[localId] = sid;
        }
        await logSync(client, farmId, {
            module: 'base',
            status: 'ok',
            action: dryRun ? 'push_dry_run' : 'push',
            device_id: body.device_id,
        });
        if (dryRun) {
            await client.query('ROLLBACK');
        }
        else {
            await client.query('COMMIT');
        }
        return { farm_cloud_id: farmId, mapping, synced_at };
    }
    catch (e) {
        await client.query('ROLLBACK').catch(() => { });
        throw e;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=baseSync.service.js.map