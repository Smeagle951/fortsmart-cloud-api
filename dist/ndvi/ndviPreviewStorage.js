import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';

function envFirst(...names) {
  for (const name of names) {
    const v = String(process.env[name] ?? '').trim();
    if (v) return v;
  }
  return '';
}

function isStorageConfigured() {
  return Boolean(
    envFirst('FORTSMART_S3_BUCKET', 'R2_BUCKET_NAME') &&
      envFirst(
        'FORTSMART_S3_ACCESS_KEY',
        'FORTSMART_S3_ACCESS_KEY_ID',
        'R2_ACCESS_KEY_ID',
      ) &&
      envFirst(
        'FORTSMART_S3_SECRET_KEY',
        'FORTSMART_S3_SECRET_ACCESS_KEY',
        'R2_SECRET_ACCESS_KEY',
      ) &&
      (envFirst('FORTSMART_S3_ENDPOINT', 'R2_ENDPOINT') ||
        envFirst('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID')) &&
      envFirst(
        'FORTSMART_S3_PUBLIC_BASE_URL',
        'R2_PUBLIC_BASE_URL',
        'NDVI_PUBLIC_BASE_URL',
      ),
  );
}

function buildS3Client() {
  const endpoint =
    envFirst('FORTSMART_S3_ENDPOINT', 'R2_ENDPOINT') ||
    `https://${envFirst('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID')}.r2.cloudflarestorage.com`;

  return new S3Client({
    region: envFirst('FORTSMART_S3_REGION', 'R2_REGION', 'AWS_REGION') || 'auto',
    endpoint,
    credentials: {
      accessKeyId: envFirst(
        'FORTSMART_S3_ACCESS_KEY',
        'FORTSMART_S3_ACCESS_KEY_ID',
        'R2_ACCESS_KEY_ID',
      ),
      secretAccessKey: envFirst(
        'FORTSMART_S3_SECRET_KEY',
        'FORTSMART_S3_SECRET_ACCESS_KEY',
        'R2_SECRET_ACCESS_KEY',
      ),
    },
    forcePathStyle: true,
  });
}

/**
 * Faz upload do PNG NDVI e retorna URL pública, ou data URL se storage indisponível.
 */
function safePathSegment(value, fallback = 'unknown') {
  const text = String(value || fallback).trim();
  return text.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96) || fallback;
}

export async function storeNdviPreviewPng({
  farmId,
  plotId,
  sceneId,
  imageDate,
  visualMode = 'ndvi_contrast',
  rendererVersion = 'agronomic_contrast_v2',
  buffer,
}) {
  if (!buffer?.length) return null;

  const stamp = String(imageDate || '').slice(0, 10).replace(/-/g, '') || 'unknown';
  const mode = safePathSegment(visualMode, 'ndvi_contrast');
  const renderer = safePathSegment(rendererVersion, 'agronomic_contrast_v2');
  const sceneKey = safePathSegment(sceneId, stamp);
  const hash = createHash('sha256')
    .update(`${farmId}|${plotId}|${sceneId}|${stamp}|${mode}|${renderer}`)
    .digest('hex')
    .slice(0, 12);
  const key = `ndvi/previews/${plotId}/${sceneKey}/${mode}_${renderer}_${hash}.png`;

  if (isStorageConfigured()) {
    try {
      const bucket = envFirst('FORTSMART_S3_BUCKET', 'R2_BUCKET_NAME');
      const publicBase = envFirst(
        'FORTSMART_S3_PUBLIC_BASE_URL',
        'R2_PUBLIC_BASE_URL',
        'NDVI_PUBLIC_BASE_URL',
      ).replace(/\/+$/, '');
      const client = buildS3Client();
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: 'image/png',
          CacheControl: 'public, max-age=259200',
        }),
      );
      const publicUrl = `${publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
      console.log(`✅ [NDVI][Storage] preview uploaded key=${key}`);
      return publicUrl;
    } catch (error) {
      console.warn(`⚠️ [NDVI][Storage] upload falhou: ${error.message}`);
    }
  }

  if (buffer.length <= 900_000) {
    const b64 = buffer.toString('base64');
    return `data:image/png;base64,${b64}`;
  }

  return null;
}

export { isStorageConfigured };
