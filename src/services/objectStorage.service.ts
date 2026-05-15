import { PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';

export type PutObjectResult = {
  bucket: string;
  key: string;
  publicUrl: string;
};

function env(name: string): string {
  return String(process.env[name] ?? '').trim();
}

export function isObjectStorageConfigured(): boolean {
  const bucket = env('FORTSMART_S3_BUCKET') || env('R2_BUCKET_NAME');
  const accessKey = env('FORTSMART_S3_ACCESS_KEY') || env('R2_ACCESS_KEY_ID');
  const secretKey = env('FORTSMART_S3_SECRET_KEY') || env('R2_SECRET_ACCESS_KEY');
  const endpoint = env('FORTSMART_S3_ENDPOINT') || env('R2_ENDPOINT');
  return Boolean(bucket && accessKey && secretKey && endpoint);
}

function buildClient(): S3Client {
  const region = env('FORTSMART_S3_REGION') || env('AWS_REGION') || 'auto';
  const endpoint = env('FORTSMART_S3_ENDPOINT') || env('R2_ENDPOINT');
  const accessKeyId = env('FORTSMART_S3_ACCESS_KEY') || env('R2_ACCESS_KEY_ID');
  const secretAccessKey = env('FORTSMART_S3_SECRET_KEY') || env('R2_SECRET_ACCESS_KEY');

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('Storage S3/R2: defina FORTSMART_S3_ENDPOINT, FORTSMART_S3_ACCESS_KEY e FORTSMART_S3_SECRET_KEY (ou equivalentes R2_*).');
  }

  const cfg: S3ClientConfig = {
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  };
  return new S3Client(cfg);
}

/**
 * Faz upload para bucket S3-compatible (Cloudflare R2, MinIO, etc.).
 * `publicBaseUrl` deve ser a URL pública de leitura (ex.: https://pub-xxx.r2.dev ou domínio custom).
 */
export async function putPublicObject(params: {
  key: string;
  body: Buffer;
  contentType: string;
  cacheControl?: string;
}): Promise<PutObjectResult> {
  const bucket = env('FORTSMART_S3_BUCKET') || env('R2_BUCKET_NAME');
  if (!bucket) {
    throw new Error('Defina FORTSMART_S3_BUCKET (ou R2_BUCKET_NAME).');
  }

  const publicBase =
    env('FORTSMART_S3_PUBLIC_BASE_URL') ||
    env('R2_PUBLIC_BASE_URL') ||
    env('CLOUDFLARE_R2_PUBLIC_BASE_URL');
  if (!publicBase) {
    throw new Error('Defina FORTSMART_S3_PUBLIC_BASE_URL (URL pública de leitura do bucket, sem barra final).');
  }

  const client = buildClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      CacheControl: params.cacheControl ?? 'public, max-age=259200',
    }),
  );

  const base = publicBase.replace(/\/+$/, '');
  const publicUrl = `${base}/${params.key.split('/').map(encodeURIComponent).join('/')}`;

  return { bucket, key: params.key, publicUrl };
}
