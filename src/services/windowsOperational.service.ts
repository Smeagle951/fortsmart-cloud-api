import type { Pool } from 'pg';
import { loadOperationalRows } from '../repositories/operationalSync.repository.js';
import type { OperationalModule } from '../validators/operationalSync.validator.js';

export type WindowsOperationalPayload = {
  farm_id: string;
  module: OperationalModule;
  records: Record<string, unknown>[];
  summary: {
    total: number;
  };
};

export async function loadWindowsOperational(
  pool: Pool,
  module: OperationalModule,
  farmId: string,
): Promise<WindowsOperationalPayload> {
  const client = await pool.connect();
  try {
    const records = await loadOperationalRows(client, module, farmId);
    return {
      farm_id: farmId,
      module,
      records,
      summary: {
        total: records.length,
      },
    };
  } finally {
    client.release();
  }
}
