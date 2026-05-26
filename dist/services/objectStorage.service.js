import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
function env(name) {
    return String(process.env[name] ?? '').trim();
}
function envFirst(...names) {
    for (const name of names) {
        const v = env(name);
        if (v)
            return v;
    }
    return '';
}
export function resolveS3Bucket() {
    return envFirst('FORTSMART_S3_BUCKET', 'R2_BUCKET_NAME');
}
export function resolveS3AccessKeyId() {
    return envFirst('FORTSMART_S3_ACCESS_KEY', 'FORTSMART_S3_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID');
}
export function resolveS3SecretAccessKey() {
    return envFirst('FORTSMART_S3_SECRET_KEY', 'FORTSMART_S3_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY');
}
/** Endpoint S3-compatible do R2 (ou outro provedor). */
export function resolveS3Endpoint() {
    const explicit = envFirst('FORTSMART_S3_ENDPOINT', 'R2_ENDPOINT');
    if (explicit)
        return explicit;
    const accountId = envFirst('R2_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID');
    if (accountId)
        return `https://${accountId}.r2.cloudflarestorage.com`;
    return '';
}
export function resolveS3PublicBaseUrl() {
    return envFirst('FORTSMART_S3_PUBLIC_BASE_URL', 'R2_PUBLIC_BASE_URL', 'CLOUDFLARE_R2_PUBLIC_BASE_URL');
}
function resolveS3Region() {
    return envFirst('FORTSMART_S3_REGION', 'R2_REGION', 'AWS_REGION') || 'auto';
}
export function getObjectStorageConfigStatus() {
    const bucket = resolveS3Bucket();
    const accessKeyId = resolveS3AccessKeyId();
    const secretAccessKey = resolveS3SecretAccessKey();
    const endpoint = resolveS3Endpoint();
    const publicBaseUrl = resolveS3PublicBaseUrl();
    const missing = [];
    if (!bucket)
        missing.push('FORTSMART_S3_BUCKET ou R2_BUCKET_NAME');
    if (!accessKeyId) {
        missing.push('FORTSMART_S3_ACCESS_KEY (ou FORTSMART_S3_ACCESS_KEY_ID / R2_ACCESS_KEY_ID)');
    }
    if (!secretAccessKey) {
        missing.push('FORTSMART_S3_SECRET_KEY (ou FORTSMART_S3_SECRET_ACCESS_KEY / R2_SECRET_ACCESS_KEY)');
    }
    if (!endpoint) {
        missing.push('FORTSMART_S3_ENDPOINT ou R2_ENDPOINT (ou R2_ACCOUNT_ID para montar o endpoint)');
    }
    if (!publicBaseUrl) {
        missing.push('FORTSMART_S3_PUBLIC_BASE_URL (ou R2_PUBLIC_BASE_URL)');
    }
    return {
        configured: missing.length === 0,
        missing,
        bucket: bucket || null,
        endpoint: endpoint || null,
        publicBaseUrl: publicBaseUrl || null,
    };
}
export function isObjectStorageConfigured() {
    return getObjectStorageConfigStatus().configured;
}
/** Lista de variáveis de ambiente ausentes (sem valores sensíveis). */
export function getObjectStorageMissingConfig() {
    return getObjectStorageConfigStatus().missing;
}
/** URL pública de leitura do bucket, ou null se não configurada. */
export function getObjectStoragePublicBaseUrl() {
    const url = resolveS3PublicBaseUrl();
    return url || null;
}
function buildClient() {
    const endpoint = resolveS3Endpoint();
    const accessKeyId = resolveS3AccessKeyId();
    const secretAccessKey = resolveS3SecretAccessKey();
    if (!endpoint || !accessKeyId || !secretAccessKey) {
        throw new Error('Storage S3/R2: defina endpoint + access key + secret (FORTSMART_S3_* ou R2_*).');
    }
    const cfg = {
        region: resolveS3Region(),
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
export async function putPublicObject(params) {
    const bucket = resolveS3Bucket();
    if (!bucket) {
        throw new Error('Defina FORTSMART_S3_BUCKET (ou R2_BUCKET_NAME).');
    }
    const publicBase = resolveS3PublicBaseUrl();
    if (!publicBase) {
        throw new Error('Defina FORTSMART_S3_PUBLIC_BASE_URL (URL pública de leitura do bucket, sem barra final).');
    }
    const client = buildClient();
    await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        CacheControl: params.cacheControl ?? 'public, max-age=259200',
    }));
    const base = publicBase.replace(/\/+$/, '');
    const publicUrl = `${base}/${params.key.split('/').map(encodeURIComponent).join('/')}`;
    return { bucket, key: params.key, publicUrl };
}
//# sourceMappingURL=objectStorage.service.js.map