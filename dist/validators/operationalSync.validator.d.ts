export type OperationalModule = 'monitoring-report' | 'planting' | 'plant-stand' | 'phenology' | 'geo-export';
export type OperationalPushBody = {
    device_id: string;
    farm_local_id: string;
    farm_cloud_id: string;
    records: Record<string, unknown>[];
    /** Planting: linhas órfãs / redundantes (mesmo contrato do app mobile). */
    stand_evaluations_all?: Record<string, unknown>[];
    cv_records_all?: Record<string, unknown>[];
    calibration_records_all?: Record<string, unknown>[];
    phenology_records_all?: Record<string, unknown>[];
    geo_exports_all?: Record<string, unknown>[];
};
export declare function parseOperationalPushBody(raw: unknown, module: OperationalModule): OperationalPushBody;
//# sourceMappingURL=operationalSync.validator.d.ts.map