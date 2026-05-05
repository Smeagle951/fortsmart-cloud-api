export type FarmPayload = {
    local_id: string;
    name: string;
    owner_name: string | null;
    city: string | null;
    state: string | null;
    total_area_ha: number | null;
    updated_at: string | null;
    deleted_at: string | null;
};
export type PlotPayload = Record<string, unknown>;
export type SeasonPayload = Record<string, unknown>;
export type CropPayload = Record<string, unknown>;
export type SubareaPayload = Record<string, unknown>;
export type BasePushBody = {
    device_id: string;
    farm_local_id: string;
    farm: FarmPayload;
    seasons: SeasonPayload[];
    crops: CropPayload[];
    plots: PlotPayload[];
    subareas: SubareaPayload[];
};
export declare function parseBasePushBody(raw: unknown): BasePushBody;
//# sourceMappingURL=baseSync.validator.d.ts.map