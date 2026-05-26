export type DecisionInsightPushItem = Record<string, unknown>;
export type DecisionInsightPushBody = {
    device_id?: string;
    farm_local_id: string;
    farm_cloud_id: string;
    items: DecisionInsightPushItem[];
};
export declare function parseDecisionInsightsPushBody(raw: unknown): DecisionInsightPushBody;
export declare function normalizePushItem(item: DecisionInsightPushItem): Record<string, unknown>;
//# sourceMappingURL=decisionInsightsSync.validator.d.ts.map