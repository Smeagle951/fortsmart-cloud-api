import type { Request } from 'express';
import { HttpError } from '../middleware/errorHandler.js';
import { isCloudFarmUuid } from './cloudFarmUuid.js';

/**
 * Mesma regra para `/windows/base`, `/windows/planting`, `/windows/monitoring`, etc.:
 * - `farmId` só em `req.params.farmId` (sem query/body).
 * - UUID cloud válido.
 * - `api_keys.farm_id` preenchido e igual ao `:farmId` da rota.
 */
export function assertWindowsFarmScope(req: Request): string {
  const farmId = req.params.farmId?.trim() ?? '';
  if (!isCloudFarmUuid(farmId)) {
    throw new HttpError('farmId must be the cloud farm UUID', 400);
  }
  const auth = req.cloudAuth;
  if (!auth?.farmId) {
    throw new HttpError('API key not linked to a farm yet', 403);
  }
  if (auth.farmId.toLowerCase() !== farmId.toLowerCase()) {
    throw new HttpError('Forbidden', 403);
  }
  return farmId;
}
