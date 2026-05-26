/**
 * RFC 4122 UUID (case-insensitive). Mesmo critério para todas as rotas GET /windows/*.
 */
export const CLOUD_FARM_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isCloudFarmUuid(value) {
    return CLOUD_FARM_UUID_RE.test(value.trim());
}
//# sourceMappingURL=cloudFarmUuid.js.map