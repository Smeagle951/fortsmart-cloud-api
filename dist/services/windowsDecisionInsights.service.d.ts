import type { Pool } from 'pg';
import { type DecisionInsightRow } from '../repositories/decisionInsightsSync.repository.js';
export declare function mapRowToDesktopDto(row: DecisionInsightRow): Record<string, unknown>;
export declare function loadWindowsDecisionInsights(pool: Pool, farmCloudId: string): Promise<Record<string, unknown>>;
//# sourceMappingURL=windowsDecisionInsights.service.d.ts.map