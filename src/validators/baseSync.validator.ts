import { HttpError } from '../middleware/errorHandler.js';

export type FarmPayload = {
  local_id: string;
  name: string;
  owner_name: string | null;
  city: string | null;
  state: string | null;
  total_area_ha: number | null;
  updated_at: string | null;
  deleted_at: string | null;
};

export type PlotPayload = Record<string, unknown>;
export type SeasonPayload = Record<string, unknown>;
export type CropPayload = Record<string, unknown>;
export type SubareaPayload = Record<string, unknown>;

export type BasePushBody = {
  device_id: string;
  farm_local_id: string;
  farm: FarmPayload;
  seasons: SeasonPayload[];
  crops: CropPayload[];
  plots: PlotPayload[];
  subareas: SubareaPayload[];
};

function requireStr(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new HttpError(`${field} is required`, 400);
  }
  return v.trim();
}

function optionalStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function optionalNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseFarm(v: unknown): FarmPayload {
  if (typeof v !== 'object' || v === null) {
    throw new HttpError('farm must be an object', 400);
  }
  const o = v as Record<string, unknown>;
  const local_id = requireStr(o.local_id, 'farm.local_id');
  return {
    local_id,
    name: requireStr(o.name, 'farm.name'),
    owner_name: optionalStr(o.owner_name),
    city: optionalStr(o.city),
    state: optionalStr(o.state),
    total_area_ha: optionalNum(o.total_area_ha),
    updated_at: optionalStr(o.updated_at),
    deleted_at: optionalStr(o.deleted_at),
  };
}

function asArray(v: unknown, field: string): unknown[] {
  if (v == null) return [];
  if (!Array.isArray(v)) {
    throw new HttpError(`${field} must be an array`, 400);
  }
  return v;
}

export function parseBasePushBody(raw: unknown): BasePushBody {
  if (typeof raw !== 'object' || raw === null) {
    throw new HttpError('Invalid JSON body', 400);
  }
  const o = raw as Record<string, unknown>;
  const device_id = requireStr(o.device_id, 'device_id');
  const farm_local_id = requireStr(o.farm_local_id, 'farm_local_id');
  const farm = parseFarm(o.farm);
  if (farm.local_id !== farm_local_id) {
    throw new HttpError('farm.local_id must equal farm_local_id', 400);
  }
  return {
    device_id,
    farm_local_id,
    farm,
    seasons: asArray(o.seasons, 'seasons') as SeasonPayload[],
    crops: asArray(o.crops, 'crops') as CropPayload[],
    plots: asArray(o.plots, 'plots') as PlotPayload[],
    subareas: asArray(o.subareas, 'subareas') as SubareaPayload[],
  };
}
