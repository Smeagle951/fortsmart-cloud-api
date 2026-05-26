import type { Pool } from 'pg';
export type PlantingMapWindowsResponse = {
    farm: Record<string, unknown>;
    plots: Array<Record<string, unknown>>;
    subareas: Array<Record<string, unknown>>;
    geo_features: Array<Record<string, unknown>>;
    summary: {
        area_total: number;
        total_talhoes: number;
        total_subareas: number;
        culturas: string[];
        materiais: string[];
        plantios_ativos: number;
    };
};
export declare function loadPlantingMapWindowsPayload(pool: Pool, farmId: string): Promise<PlantingMapWindowsResponse>;
//# sourceMappingURL=windowsPlantingMap.service.d.ts.map