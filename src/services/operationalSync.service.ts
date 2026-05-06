import type { Pool } from 'pg';
import { HttpError } from '../middleware/errorHandler.js';
import {
  logSync,
  upsertOperationalRecords,
  type ItemFailure,
} from '../repositories/operationalSync.repository.js';
import type {
  OperationalModule,
  OperationalPushBody,
} from '../validators/operationalSync.validator.js';

export type OperationalPushResult = {
  farm_cloud_id: string;
  mapping: Record<string, string>;
  failed: ItemFailure[];
  synced_at: string;
};

async function validateFarmLink(
  client: import('pg').PoolClient,
  apiKeyId: string,
  body: OperationalPushBody,
): Promise<string> {
  const { rows: keyRows } = await client.query<{ farm_id: string | null }>(
    `SELECT farm_id FROM api_keys WHERE id = $1 FOR UPDATE`,
    [apiKeyId],
  );
  const linkedFarmId = keyRows[0]?.farm_id ?? null;
  if (!linkedFarmId) {
    throw new HttpError('Faça primeiro a sincronização base para vincular a fazenda.', 403);
  }
  if (linkedFarmId.toLowerCase() !== body.farm_cloud_id.toLowerCase()) {
    throw new HttpError('farm_cloud_id does not match the farm linked to this API key', 403);
  }
  return linkedFarmId;
}

export async function pushOperationalSync(
  pool: Pool,
  apiKeyId: string,
  module: OperationalModule,
  body: OperationalPushBody,
): Promise<OperationalPushResult> {
  const synced_at = new Date().toISOString();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const farmId = await validateFarmLink(client, apiKeyId, body);
    const result = await upsertOperationalRecords(
      client,
      module,
      farmId,
      body.records,
      body.device_id,
    );
    await logSync(client, farmId, {
      module,
      action: 'push',
      status: result.failed.length === 0 ? 'ok' : 'partial',
      error_message:
        result.failed.length === 0 ? undefined : `${result.failed.length} item(s) falharam`,
      device_id: body.device_id,
    });
    await client.query('COMMIT');
    return {
      farm_cloud_id: farmId,
      mapping: result.mapping,
      failed: result.failed,
      synced_at,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
