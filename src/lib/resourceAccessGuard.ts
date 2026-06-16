import type { Pool, PoolClient } from 'pg';
import type { Request } from 'express';
import { HttpError } from '../middleware/errorHandler.js';
import { isCloudFarmUuid } from './cloudFarmUuid.js';

type Queryable = Pick<Pool | PoolClient, 'query'>;

function normalizeText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeUuid(value: unknown): string | null {
  const text = normalizeText(value);
  return text && isCloudFarmUuid(text) ? text : null;
}

export function assertApiKeyCanAccessFarm(req: Request, farmId: string): string {
  const requestedFarmId = normalizeUuid(farmId);
  if (!requestedFarmId) {
    throw new HttpError('farmId must be the cloud farm UUID', 400);
  }

  const linkedFarmId = req.cloudAuth?.farmId;
  if (!linkedFarmId) {
    throw new HttpError('API key not linked to a farm yet', 403);
  }

  if (linkedFarmId.toLowerCase() !== requestedFarmId.toLowerCase()) {
    throw new HttpError('Forbidden', 403);
  }

  return requestedFarmId;
}

export async function assertPlotBelongsToFarm(
  db: Queryable,
  args: {
    farmId: string;
    plotCloudId?: unknown;
    plotLocalId?: unknown;
    required?: boolean;
  },
): Promise<void> {
  const farmId = normalizeUuid(args.farmId);
  if (!farmId) {
    throw new HttpError('farmId must be the cloud farm UUID', 400);
  }

  const plotCloudId = normalizeUuid(args.plotCloudId);
  const plotLocalId = normalizeText(args.plotLocalId);
  if (!plotCloudId && !plotLocalId) {
    if (args.required) {
      throw new HttpError('plot_id or plot_local_id is required', 400);
    }
    return;
  }

  const { rows } = await db.query<{ id: string }>(
    `SELECT id::text AS id
       FROM plots
      WHERE farm_id = $1::uuid
        AND deleted_at IS NULL
        AND (
          ($2::uuid IS NOT NULL AND id = $2::uuid)
          OR ($3::text IS NOT NULL AND local_id = $3::text)
        )
      LIMIT 1`,
    [farmId, plotCloudId, plotLocalId],
  );

  if (!rows[0]?.id) {
    throw new HttpError('plot does not belong to this farm', 403);
  }
}

export async function assertSeasonBelongsToFarm(
  db: Queryable,
  args: {
    farmId: string;
    seasonCloudId?: unknown;
    seasonLocalId?: unknown;
    required?: boolean;
  },
): Promise<void> {
  const farmId = normalizeUuid(args.farmId);
  if (!farmId) {
    throw new HttpError('farmId must be the cloud farm UUID', 400);
  }

  const seasonCloudId = normalizeUuid(args.seasonCloudId);
  const seasonLocalId = normalizeText(args.seasonLocalId);
  if (!seasonCloudId && !seasonLocalId) {
    if (args.required) {
      throw new HttpError('season_id or season_local_id is required', 400);
    }
    return;
  }

  const { rows } = await db.query<{ id: string }>(
    `SELECT id::text AS id
       FROM seasons
      WHERE farm_id = $1::uuid
        AND deleted_at IS NULL
        AND (
          ($2::uuid IS NOT NULL AND id = $2::uuid)
          OR ($3::text IS NOT NULL AND local_id = $3::text)
        )
      LIMIT 1`,
    [farmId, seasonCloudId, seasonLocalId],
  );

  if (!rows[0]?.id) {
    throw new HttpError('season does not belong to this farm', 403);
  }
}
