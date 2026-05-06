import { Router } from 'express';
import { getPool } from '../db/pool.js';
import { HttpError } from '../middleware/errorHandler.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { loadWindowsOperational } from '../services/windowsOperational.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { jsonOk } from '../utils/response.js';
import type { OperationalModule } from '../validators/operationalSync.validator.js';

export const windowsOperationalRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

function registerWindowGet(path: string, module: OperationalModule): void {
  windowsOperationalRouter.get(
    path,
    requireApiKey,
    asyncHandler(async (req, res) => {
      const farmId = req.params.farmId?.trim() ?? '';
      if (!UUID_RE.test(farmId)) {
        throw new HttpError('farmId must be the cloud farm UUID', 400);
      }
      const auth = req.cloudAuth;
      if (!auth?.farmId) {
        throw new HttpError('API key not linked to a farm yet', 403);
      }
      if (auth.farmId.toLowerCase() !== farmId.toLowerCase()) {
        throw new HttpError('Forbidden', 403);
      }
      const data = await loadWindowsOperational(getPool(), module, farmId);
      jsonOk(res, { data });
    }),
  );
}

registerWindowGet('/windows/monitoring/:farmId', 'monitoring-report');
registerWindowGet('/windows/planting/:farmId', 'planting');
registerWindowGet('/windows/phenology/:farmId', 'phenology');
registerWindowGet('/windows/geo/:farmId', 'geo-export');
