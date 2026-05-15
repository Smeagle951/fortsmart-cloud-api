import type { Pool } from 'pg';
import { HttpError } from '../middleware/errorHandler.js';
import { isObjectStorageConfigured, putPublicObject } from './objectStorage.service.js';

const TEMP_DAYS = 3;

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  return 'bin';
}

function sanitizeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

export type PlantingImageUploadInput = {
  farmId: string;
  farmCloudId: string;
  imageLocalId: string;
  /** local_id do plantio no app (planting_records.local_id). */
  plantingLocalId: string;
  plotLocalId?: string | null;
  takenAt?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  originalFileName?: string | null;
  caption?: string | null;
  contentType: string;
  buffer: Buffer;
};

export type PlantingImageUploadResult = {
  image_id: string;
  cloud_url: string;
  cloud_storage_key: string;
  cloud_expires_at: string;
  local_file_name: string | null;
};

export async function uploadPlantingImage(
  pool: Pool,
  input: PlantingImageUploadInput,
): Promise<PlantingImageUploadResult> {
  if (!isObjectStorageConfigured()) {
    throw new HttpError(
      'Armazenamento de objetos não configurado (FORTSMART_S3_* / R2_*). Não é possível receber upload.',
      503,
    );
  }

  const ext = extFromMime(input.contentType || 'application/octet-stream');
  const datePrefix = new Date().toISOString().slice(0, 10);
  const talhaoSeg =
    (input.plotLocalId && sanitizeSegment(String(input.plotLocalId))) ||
    (input.plantingLocalId && sanitizeSegment(String(input.plantingLocalId))) ||
    'talhao';
  const storageKey = `${input.farmId}/talhao/${talhaoSeg}/planting/${datePrefix}/${sanitizeSegment(input.imageLocalId)}.${ext}`;

  const { key, publicUrl } = await putPublicObject({
    key: storageKey,
    body: input.buffer,
    contentType: input.contentType || 'application/octet-stream',
  });

  const expiresAt = new Date(Date.now() + TEMP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const localName =
    (input.originalFileName && sanitizeSegment(String(input.originalFileName))) ||
    `${sanitizeSegment(input.imageLocalId)}.${ext}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: plantingRows } = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM planting_records
       WHERE farm_id = $1::uuid AND local_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [input.farmId, input.plantingLocalId],
    );
    const plantingRecordId = plantingRows[0]?.id ?? null;
    if (!plantingRecordId) {
      throw new HttpError(
        'Registro de plantio não encontrado na nuvem. Envie primeiro POST /sync/planting/push para este plantio.',
        400,
      );
    }

    const takenAt = input.takenAt ? new Date(input.takenAt) : new Date();
    const takenIso = Number.isNaN(takenAt.getTime()) ? new Date().toISOString() : takenAt.toISOString();

    const { rows: upserted } = await client.query<{ id: string }>(
      `INSERT INTO planting_images (
         local_id, farm_id, planting_record_id, planting_local_id,
         file_name, local_path, cloud_url, cloud_storage_key, cloud_expires_at,
         caption, taken_at, latitude, longitude, raw_payload
       )
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8::timestamptz, $9, $10::timestamptz, $11, $12, $13::jsonb)
       ON CONFLICT (farm_id, local_id) DO UPDATE SET
         planting_record_id = COALESCE(EXCLUDED.planting_record_id, planting_images.planting_record_id),
         planting_local_id = COALESCE(EXCLUDED.planting_local_id, planting_images.planting_local_id),
         file_name = COALESCE(EXCLUDED.file_name, planting_images.file_name),
         cloud_url = EXCLUDED.cloud_url,
         cloud_storage_key = EXCLUDED.cloud_storage_key,
         cloud_expires_at = EXCLUDED.cloud_expires_at,
         caption = COALESCE(EXCLUDED.caption, planting_images.caption),
         taken_at = COALESCE(EXCLUDED.taken_at, planting_images.taken_at),
         latitude = COALESCE(EXCLUDED.latitude, planting_images.latitude),
         longitude = COALESCE(EXCLUDED.longitude, planting_images.longitude),
         updated_at = NOW()
       RETURNING id`,
      [
        input.imageLocalId,
        input.farmId,
        plantingRecordId,
        input.plantingLocalId,
        localName,
        publicUrl,
        key,
        expiresAt,
        input.caption ?? null,
        takenIso,
        input.latitude != null && input.latitude !== '' ? Number(input.latitude) : null,
        input.longitude != null && input.longitude !== '' ? Number(input.longitude) : null,
        JSON.stringify({
          uploaded_via: 'sync/planting/image',
          farm_cloud_id: input.farmCloudId,
          image_local_id: input.imageLocalId,
          planting_local_id: input.plantingLocalId,
        }),
      ],
    );

    const imageId = upserted[0]?.id;
    if (!imageId) {
      throw new HttpError('Falha ao gravar metadados da imagem de plantio.', 500);
    }

    await client.query('COMMIT');
    return {
      image_id: imageId,
      cloud_url: publicUrl,
      cloud_storage_key: key,
      cloud_expires_at: expiresAt,
      local_file_name: localName,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
