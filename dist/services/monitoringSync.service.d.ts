import type { Pool } from 'pg';
type MonitoringPushBody = {
    schema_version?: unknown;
    device_id?: unknown;
    generated_at?: unknown;
    summary?: unknown;
    sessions?: unknown;
};
export declare function pushMonitoringSync(pool: Pool, apiKeyId: string, body: MonitoringPushBody): Promise<{
    payload_id: string;
    synced_at: string;
}>;
export {};
//# sourceMappingURL=monitoringSync.service.d.ts.map