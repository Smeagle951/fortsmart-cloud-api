import { HttpError } from '../middleware/errorHandler.js';
import { isObjectStorageConfigured, putPublicObject } from './objectStorage.service.js';
const TEMP_DAYS = 3;
function extFromMime(mime) {
    const m = mime.toLowerCase();
    if (m.includes('png'))
        return 'png';
    if (m.includes('webp'))
        return 'webp';
    if (m.includes('jpeg') || m.includes('jpg'))
        return 'jpg';
    return 'bin';
}
function sanitizeSegment(s) {
    return s.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}
export async function uploadMonitoringImage(pool, input) {
    if (!isObjectStorageConfigured()) {
        throw new HttpError('Armazenamento de objetos não configurado (FORTSMART_S3_* / R2_*). Não é possível receber upload.', 503);
    }
    const ext = extFromMime(input.contentType || 'application/octet-stream');
    const datePrefix = new Date().toISOString().slice(0, 10);
    const talhaoSeg = (input.plotLocalId && sanitizeSegment(String(input.plotLocalId))) ||
        (input.reportLocalId && sanitizeSegment(String(input.reportLocalId))) ||
        'talhao';
    const storageKey = `${input.farmId}/talhao/${talhaoSeg}/monitoring/${datePrefix}/${sanitizeSegment(input.imageLocalId)}.${ext}`;
    const { key, publicUrl } = await putPublicObject({
        key: storageKey,
        body: input.buffer,
        contentType: input.contentType || 'application/octet-stream',
    });
    const expiresAt = new Date(Date.now() + TEMP_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const localName = (input.originalFileName && sanitizeSegment(input.originalFileName)) ||
        `${sanitizeSegment(input.imageLocalId)}.${ext}`;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let occurrenceId = null;
        let reportId = null;
        let pointId = null;
        if (input.occurrenceLocalId) {
            const { rows } = await client.query(`SELECT id, monitoring_report_id, monitoring_point_id
         FROM monitoring_occurrences
         WHERE farm_id = $1 AND local_id = $2 AND deleted_at IS NULL
         LIMIT 1`, [input.farmId, input.occurrenceLocalId]);
            occurrenceId = rows[0]?.id ?? null;
            reportId = rows[0]?.monitoring_report_id ?? null;
            pointId = rows[0]?.monitoring_point_id ?? null;
        }
        if (!pointId && input.pointLocalId) {
            const { rows } = await client.query(`SELECT id, monitoring_report_id
         FROM monitoring_points
         WHERE farm_id = $1 AND local_id = $2 AND deleted_at IS NULL
         LIMIT 1`, [input.farmId, input.pointLocalId]);
            pointId = rows[0]?.id ?? null;
            reportId = reportId ?? rows[0]?.monitoring_report_id ?? null;
        }
        if (!reportId && input.reportLocalId) {
            const { rows } = await client.query(`SELECT id FROM monitoring_reports WHERE farm_id = $1 AND local_id = $2 AND deleted_at IS NULL LIMIT 1`, [input.farmId, input.reportLocalId]);
            reportId = rows[0]?.id ?? null;
        }
        const takenAt = input.takenAt ? new Date(input.takenAt) : new Date();
        const takenIso = Number.isNaN(takenAt.getTime()) ? new Date().toISOString() : takenAt.toISOString();
        const { rows: upserted } = await client.query(`INSERT INTO monitoring_images (
         local_id, farm_id, monitoring_report_id, monitoring_point_id, occurrence_id,
         file_name, local_path, cloud_url, cloud_storage_key, cloud_expires_at,
         taken_at, latitude, longitude, raw_payload
       )
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9::timestamptz, $10::timestamptz, $11, $12, $13::jsonb)
       ON CONFLICT (farm_id, local_id) DO UPDATE SET
         monitoring_report_id = COALESCE(EXCLUDED.monitoring_report_id, monitoring_images.monitoring_report_id),
         monitoring_point_id = COALESCE(EXCLUDED.monitoring_point_id, monitoring_images.monitoring_point_id),
         occurrence_id = COALESCE(EXCLUDED.occurrence_id, monitoring_images.occurrence_id),
         file_name = COALESCE(EXCLUDED.file_name, monitoring_images.file_name),
         cloud_url = EXCLUDED.cloud_url,
         cloud_storage_key = EXCLUDED.cloud_storage_key,
         cloud_expires_at = EXCLUDED.cloud_expires_at,
         taken_at = COALESCE(EXCLUDED.taken_at, monitoring_images.taken_at),
         latitude = COALESCE(EXCLUDED.latitude, monitoring_images.latitude),
         longitude = COALESCE(EXCLUDED.longitude, monitoring_images.longitude),
         updated_at = NOW()
       RETURNING id`, [
            input.imageLocalId,
            input.farmId,
            reportId,
            pointId,
            occurrenceId,
            localName,
            publicUrl,
            key,
            expiresAt,
            takenIso,
            input.latitude != null && input.latitude !== '' ? Number(input.latitude) : null,
            input.longitude != null && input.longitude !== '' ? Number(input.longitude) : null,
            JSON.stringify({
                uploaded_via: 'sync/monitoring-report/image',
                farm_cloud_id: input.farmCloudId,
                image_local_id: input.imageLocalId,
            }),
        ]);
        const imageId = upserted[0]?.id;
        if (!imageId) {
            throw new HttpError('Falha ao gravar metadados da imagem.', 500);
        }
        await client.query('COMMIT');
        return {
            image_id: imageId,
            cloud_url: publicUrl,
            cloud_storage_key: key,
            cloud_expires_at: expiresAt,
            local_file_name: localName,
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
export async function resolveFarmIdForApiKey(pool, apiKeyId, farmCloudId) {
    const { rows } = await pool.query(`SELECT farm_id FROM api_keys WHERE id = $1`, [apiKeyId]);
    const farmId = rows[0]?.farm_id;
    if (!farmId) {
        throw new HttpError('Faça primeiro a sincronização base para vincular a fazenda.', 403);
    }
    if (farmId.toLowerCase() !== farmCloudId.toLowerCase().trim()) {
        throw new HttpError('farm_cloud_id não corresponde à fazenda desta API key.', 403);
    }
    return farmId;
}
//# sourceMappingURL=monitoringMedia.service.js.map