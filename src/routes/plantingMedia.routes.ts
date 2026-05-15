import { Router } from 'express';
import multer from 'multer';
import { getPool } from '../db/pool.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { jsonOk } from '../utils/response.js';
import { resolveFarmIdForApiKey } from '../services/monitoringMedia.service.js';
import { uploadPlantingImage } from '../services/plantingMedia.service.js';

export const plantingMediaRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

/**
 * Upload binário de imagem ligada a um plantio (object storage temporário).
 * multipart/form-data:
 * - file (obrigatório)
 * - farm_cloud_id (obrigatório)
 * - image_local_id (obrigatório, mesmo id enviado no push em record.images)
 * - planting_local_id (obrigatório, local_id do plantio / planting_records)
 * - plot_local_id (opcional)
 * - taken_at, latitude, longitude, caption (opcional)
 */
plantingMediaRouter.post(
  '/sync/planting/image',
  requireApiKey,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const auth = req.cloudAuth;
    if (!auth) throw new HttpError('Unauthorized', 401);
    if (!req.file?.buffer?.length) {
      throw new HttpError('Campo multipart "file" é obrigatório.', 400);
    }

    const farmCloudId = String(req.body?.farm_cloud_id ?? '').trim();
    const imageLocalId = String(req.body?.image_local_id ?? '').trim();
    const plantingLocalId = String(req.body?.planting_local_id ?? '').trim();
    if (!farmCloudId || !imageLocalId || !plantingLocalId) {
      throw new HttpError('farm_cloud_id, image_local_id e planting_local_id são obrigatórios.', 400);
    }

    const farmId = await resolveFarmIdForApiKey(getPool(), auth.apiKeyId, farmCloudId);

    const result = await uploadPlantingImage(getPool(), {
      farmId,
      farmCloudId,
      imageLocalId,
      plantingLocalId,
      plotLocalId: req.body?.plot_local_id ? String(req.body.plot_local_id) : null,
      takenAt: req.body?.taken_at ? String(req.body.taken_at) : null,
      latitude: req.body?.latitude != null ? String(req.body.latitude) : null,
      longitude: req.body?.longitude != null ? String(req.body.longitude) : null,
      originalFileName: req.file.originalname || null,
      caption: req.body?.caption ? String(req.body.caption) : null,
      contentType: req.file.mimetype || 'application/octet-stream',
      buffer: req.file.buffer,
    });

    const response = {
      ...result,
      image_cloud_id: result.image_id,
      thumbnail_url: result.cloud_url,
    };
    jsonOk(res, { ...response, data: response });
  }),
);
