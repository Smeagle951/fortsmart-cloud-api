import type { Pool } from 'pg';
import { type ItemFailure } from '../repositories/operationalSync.repository.js';
import type { OperationalModule, OperationalPushBody } from '../validators/operationalSync.validator.js';
export type OperationalPushResult = {
    farm_cloud_id: string;
    mapping: Record<string, unknown>;
    failed: ItemFailure[];
    synced_at: string;
};
export declare function pushOperationalSync(pool: Pool, apiKeyId: string, module: OperationalModule, body: OperationalPushBody): Promise<OperationalPushResult>;
//# sourceMappingURL=operationalSync.service.d.ts.map