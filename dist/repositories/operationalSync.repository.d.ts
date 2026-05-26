import type { PoolClient } from 'pg';
import type { OperationalModule } from '../validators/operationalSync.validator.js';
export type ItemFailure = {
    local_id: string | null;
    error: string;
};
export type OperationalUpsertResult = {
    mapping: Record<string, unknown>;
    failed: ItemFailure[];
};
type ModuleSpec = {
    module: OperationalModule;
    table: string;
    entity: string;
    buildValues(record: Record<string, unknown>, farmId: string): Record<string, unknown>;
};
export declare function getOperationalSpec(module: OperationalModule): ModuleSpec;
export declare function logSync(client: PoolClient, farmId: string | null, opts: {
    module: string;
    entity?: string;
    local_id?: string | null;
    cloud_id?: string | null;
    action?: string;
    status: string;
    error_message?: string;
    device_id?: string;
}): Promise<void>;
export declare function upsertOperationalRecords(client: PoolClient, module: OperationalModule, farmId: string, records: Record<string, unknown>[], deviceId: string): Promise<OperationalUpsertResult>;
export declare function upsertGeneric(client: PoolClient, table: string, values: Record<string, unknown>, jsonColumns: string[]): Promise<string>;
export declare function loadOperationalRows(client: PoolClient, module: OperationalModule, farmId: string): Promise<Record<string, unknown>[]>;
export {};
//# sourceMappingURL=operationalSync.repository.d.ts.map