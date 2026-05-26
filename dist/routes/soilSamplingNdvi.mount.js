import createNdviRouter from '../../ndvi/soilSamplingNdvi.routes.js';
import { getPool } from '../db/pool.js';
/**
 * Monta rotas NDVI (ESM) na API FortSmart Cloud.
 * Duas bases: /api/soil-sampling/ndvi e /soil-sampling/ndvi (compat Flutter).
 */
export function createSoilSamplingNdviRouter() {
    return createNdviRouter({
        pool: getPool(),
        publicBaseUrl: process.env.NDVI_PUBLIC_BASE_URL || '',
    });
}
//# sourceMappingURL=soilSamplingNdvi.mount.js.map