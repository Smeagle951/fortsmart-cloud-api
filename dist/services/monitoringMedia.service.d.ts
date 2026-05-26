import type { Pool } from 'pg';
export type MonitoringImageUploadInput = {
    farmId: string;
    farmCloudId: string;
    imageLocalId: string;
    /** Talhão no app (plot_local_id do relatório); usado na chave do object storage. */
    plotLocalId?: string | null;
    occurrenceLocalId?: string | null;
    pointLocalId?: string | null;
    reportLocalId?: string | null;
    /** ISO ou epoch ms */
    takenAt?: string | null;
    latitude?: string | null;
    longitude?: string | null;
    originalFileName?: string | null;
    contentType: string;
    buffer: Buffer;
};
export type MonitoringImageUploadResult = {
    image_id: string;
    cloud_url: string;
    cloud_storage_key: string;
    cloud_expires_at: string;
    local_file_name: string | null;
};
export declare function uploadMonitoringImage(pool: Pool, input: MonitoringImageUploadInput): Promise<MonitoringImageUploadResult>;
export declare function resolveFarmIdForApiKey(pool: Pool, apiKeyId: string, farmCloudId: string): Promise<string>;
//# sourceMappingURL=monitoringMedia.service.d.ts.map