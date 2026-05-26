import type { PoolClient } from 'pg';
import type { OperationalPushBody } from '../validators/operationalSync.validator.js';
import { type ItemFailure } from './operationalSync.repository.js';
export type PlantingBundleResult = {
    mapping: Record<string, unknown>;
    failed: ItemFailure[];
};
export declare function upsertPlantingBundle(client: PoolClient, farmId: string, records: Record<string, unknown>[], body: OperationalPushBody, deviceId: string): Promise<PlantingBundleResult>;
export declare function loadPlantingWindowsPayload(client: PoolClient, farmId: string): Promise<Record<string, unknown>>;
//# sourceMappingURL=plantingSync.repository.d.ts.map