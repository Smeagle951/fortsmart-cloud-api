import type { Pool } from 'pg';
export type DecisionInsightsPushResult = {
    farm_cloud_id: string;
    received: number;
    inserted: number;
    updated: number;
    skipped: number;
    synced_at: string;
};
export declare function pushDecisionInsightsSync(pool: Pool, apiKeyId: string, rawBody: unknown): Promise<DecisionInsightsPushResult>;
//# sourceMappingURL=decisionInsightsSync.service.d.ts.map