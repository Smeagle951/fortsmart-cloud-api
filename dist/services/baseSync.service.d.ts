import type { Pool } from 'pg';
import type { BasePushBody } from '../validators/baseSync.validator.js';
export type Mapping = {
    farms: Record<string, string>;
    plots: Record<string, string>;
    subareas: Record<string, string>;
    seasons: Record<string, string>;
    crops: Record<string, string>;
};
export type PushBaseResult = {
    farm_cloud_id: string;
    mapping: Mapping;
    synced_at: string;
};
export declare function pushBaseSync(pool: Pool, apiKeyId: string, body: BasePushBody, dryRun: boolean): Promise<PushBaseResult>;
//# sourceMappingURL=baseSync.service.d.ts.map