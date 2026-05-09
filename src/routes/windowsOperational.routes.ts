import { Router } from 'express';
import { getPool } from '../db/pool.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { jsonOk } from '../utils/response.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { loadWindowsOperational } from '../services/windowsOperational.service.js';
import type { OperationalModule } from '../validators/operationalSync.validator.js';
import { assertWindowsFarmScope } from '../lib/windowsFarmScope.js';

export const windowsOperationalRouter = Router();

/** Contrato unificado para planting + monitoring-report (desktop / curl). */
function normalizeOperationalWindowsData(
  module: OperationalModule,
  farmId: string,
  payload: Awaited<ReturnType<typeof loadWindowsOperational>>,
): Record<string, unknown> {
  if (module === 'planting') {
    const p = payload as {
      records?: Record<string, unknown>[];
      summary?: Record<string, unknown>;
    };
    const plots = p.records ?? [];
    return {
      farm_id: farmId,
      summary: plots.length === 0 ? {} : (p.summary ?? {}),
      plots,
    };
  }

  if (module === 'monitoring-report') {
    const p = payload as {
      plots?: unknown[];
      summary?: Record<string, unknown>;
      diagnostics?: Record<string, unknown>;
      records?: unknown[];
      module?: string;
      farm_id?: string;
    };
    const plots = p.plots ?? [];
    const summaryFilled = {
      total_reports: 0,
      total_points: 0,
      total_occurrences: 0,
      critical_occurrences: 0,
      ...(typeof p.summary === 'object' && p.summary ? p.summary : {}),
      ...(p.diagnostics ? { diagnostics: p.diagnostics } : {}),
    };
    return {
      farm_id: farmId,
      summary: summaryFilled,
      plots,
    };
  }

  return payload as Record<string, unknown>;
}

function registerWindowGet(path: string, module: OperationalModule): void {
  windowsOperationalRouter.get(
    path,
    requireApiKey,
    asyncHandler(async (req, res) => {
      const farmId = assertWindowsFarmScope(req);
      const payload = await loadWindowsOperational(getPool(), module, farmId);

      if (module === 'planting' || module === 'monitoring-report') {
        jsonOk(res, { data: normalizeOperationalWindowsData(module, farmId, payload) });
        return;
      }

      jsonOk(res, { data: payload });
    }),
  );
}

registerWindowGet('/windows/monitoring/:farmId', 'monitoring-report');
registerWindowGet('/windows/planting/:farmId', 'planting');
registerWindowGet('/windows/phenology/:farmId', 'phenology');
registerWindowGet('/windows/geo/:farmId', 'geo-export');
