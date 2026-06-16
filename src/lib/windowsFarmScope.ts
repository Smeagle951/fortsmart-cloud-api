import type { Request } from 'express';
import { assertApiKeyCanAccessFarm } from './resourceAccessGuard.js';

/**
 * Mesma regra para `/windows/base`, `/windows/planting`, `/windows/monitoring`, etc.:
 * - `farmId` só em `req.params.farmId` (sem query/body).
 * - UUID cloud válido.
 * - `api_keys.farm_id` preenchido e igual ao `:farmId` da rota.
 */
export function assertWindowsFarmScope(req: Request): string {
  const farmId = req.params.farmId?.trim() ?? '';
  return assertApiKeyCanAccessFarm(req, farmId);
}
