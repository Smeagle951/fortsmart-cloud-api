import type { Pool } from 'pg';
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
export declare function uploadPlantingImage(pool: Pool, input: PlantingImageUploadInput): Promise<PlantingImageUploadResult>;
//# sourceMappingURL=plantingMedia.service.d.ts.map