export type PutObjectResult = {
    bucket: string;
    key: string;
    publicUrl: string;
};
export type ObjectStorageConfigStatus = {
    configured: boolean;
    missing: string[];
    bucket: string | null;
    endpoint: string | null;
    publicBaseUrl: string | null;
};
export declare function resolveS3Bucket(): string;
export declare function resolveS3AccessKeyId(): string;
export declare function resolveS3SecretAccessKey(): string;
/** Endpoint S3-compatible do R2 (ou outro provedor). */
export declare function resolveS3Endpoint(): string;
export declare function resolveS3PublicBaseUrl(): string;
export declare function getObjectStorageConfigStatus(): ObjectStorageConfigStatus;
export declare function isObjectStorageConfigured(): boolean;
/** Lista de variáveis de ambiente ausentes (sem valores sensíveis). */
export declare function getObjectStorageMissingConfig(): string[];
/** URL pública de leitura do bucket, ou null se não configurada. */
export declare function getObjectStoragePublicBaseUrl(): string | null;
/**
 * Faz upload para bucket S3-compatible (Cloudflare R2, MinIO, etc.).
 * `publicBaseUrl` deve ser a URL pública de leitura (ex.: https://pub-xxx.r2.dev ou domínio custom).
 */
export declare function putPublicObject(params: {
    key: string;
    body: Buffer;
    contentType: string;
    cacheControl?: string;
}): Promise<PutObjectResult>;
//# sourceMappingURL=objectStorage.service.d.ts.map