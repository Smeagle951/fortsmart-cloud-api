export type GeoJsonPolygon = {
    type: 'Polygon';
    coordinates: number[][][];
};
/** Valida GeoJSON mínimo tipo Polygon (anel fechado com ≥ 4 vértices). */
export declare function normalizeGeojson(input: unknown): GeoJsonPolygon;
export declare function tryNormalizeGeojson(input: unknown): GeoJsonPolygon | null;
//# sourceMappingURL=normalizeGeojson.d.ts.map