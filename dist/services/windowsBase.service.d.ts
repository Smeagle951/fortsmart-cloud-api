import type { Pool } from 'pg';
export type WindowsBasePayload = {
    farm: Record<string, unknown>;
    plots: Array<Record<string, unknown> & {
        subareas: Record<string, unknown>[];
    }>;
    seasons: Record<string, unknown>[];
    crops: Record<string, unknown>[];
    summary: {
        plotsCount: number;
        subareasCount: number;
        seasonsCount: number;
        cropsCount: number;
        totalAreaHa: number | null;
    };
};
export declare function loadWindowsBase(pool: Pool, farmUuid: string): Promise<WindowsBasePayload | null>;
//# sourceMappingURL=windowsBase.service.d.ts.map