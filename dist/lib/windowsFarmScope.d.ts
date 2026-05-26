import type { Request } from 'express';
/**
 * Mesma regra para `/windows/base`, `/windows/planting`, `/windows/monitoring`, etc.:
 * - `farmId` só em `req.params.farmId` (sem query/body).
 * - UUID cloud válido.
 * - `api_keys.farm_id` preenchido e igual ao `:farmId` da rota.
 */
export declare function assertWindowsFarmScope(req: Request): string;
//# sourceMappingURL=windowsFarmScope.d.ts.map