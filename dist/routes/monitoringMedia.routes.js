import { Router } from 'express';
import multer from 'multer';
import { getPool } from '../db/pool.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { jsonOk } from '../utils/response.js';
import { resolveFarmIdForApiKey, uploadMonitoringImage } from '../services/monitoringMedia.service.js';
export const monitoringMediaRouter = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
});
/**
 * Upload binário de imagem de monitoramento (temporário na nuvem, ~3 dias no storage).
 * multipart/form-data:
 * - file (obrigatório)
 * - farm_cloud_id (obrigatório)
 * - image_local_id (obrigatório, mesmo local_id enviado no push)
 * - occurrence_local_id (opcional)
 * - point_local_id (opcional)
 * - report_local_id (opcional)
 * - plot_local_id (opcional, talhao — recomendado para prefixo no object storage)
 * - taken_at, latitude, longitude (opcional)
 */
monitoringMediaRouter.post('/sync/monitoring-report/image', requireApiKey, upload.single('file'), asyncHandler(async (req, res) => {
    const auth = req.cloudAuth;
    if (!auth)
        throw new HttpError('Unauthorized', 401);
    if (!req.file?.buffer?.length) {
        throw new HttpError('Campo multipart "file" é obrigatório.', 400);
    }
    const farmCloudId = String(req.body?.farm_cloud_id ?? '').trim();
    const imageLocalId = String(req.body?.image_local_id ?? '').trim();
    if (!farmCloudId || !imageLocalId) {
        throw new HttpError('farm_cloud_id e image_local_id são obrigatórios.', 400);
    }
    const farmId = await resolveFarmIdForApiKey(getPool(), auth.apiKeyId, farmCloudId);
    const result = await uploadMonitoringImage(getPool(), {
        farmId,
        farmCloudId,
        imageLocalId,
        plotLocalId: req.body?.plot_local_id ? String(req.body.plot_local_id) : null,
        occurrenceLocalId: req.body?.occurrence_local_id ? String(req.body.occurrence_local_id) : null,
        pointLocalId: req.body?.point_local_id ? String(req.body.point_local_id) : null,
        reportLocalId: req.body?.report_local_id ? String(req.body.report_local_id) : null,
        takenAt: req.body?.taken_at ? String(req.body.taken_at) : null,
        latitude: req.body?.latitude != null ? String(req.body.latitude) : null,
        longitude: req.body?.longitude != null ? String(req.body.longitude) : null,
        originalFileName: req.file.originalname || null,
        contentType: req.file.mimetype || 'application/octet-stream',
        buffer: req.file.buffer,
    });
    const response = {
        ...result,
        image_cloud_id: result.image_id,
        thumbnail_url: result.cloud_url,
    };
    jsonOk(res, { ...response, data: response });
}));
//# sourceMappingURL=monitoringMedia.routes.js.map