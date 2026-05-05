import type { Pool } from 'pg';

export type WindowsBasePayload = {
  farm: Record<string, unknown>;
  plots: Array<Record<string, unknown> & { subareas: Record<string, unknown>[] }>;
  seasons: Record<string, unknown>[];
  crops: Record<string, unknown>[];
  summary: {
    plotsCount: number;
    subareasCount: number;
    seasonsCount: number;
    cropsCount: number;
    totalAreaHa: number | null;
  };
};

function rowFarm(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.id,
    local_id: r.local_id,
    name: r.name,
    owner_name: r.owner_name,
    city: r.city,
    state: r.state,
    total_area_ha: r.total_area_ha,
    is_active: r.is_active,
    deleted_at: r.deleted_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function loadWindowsBase(pool: Pool, farmUuid: string): Promise<WindowsBasePayload | null> {
  const { rows: farms } = await pool.query(
    `SELECT * FROM farms WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [farmUuid],
  );
  if (farms.length === 0) return null;

  const farm = rowFarm(farms[0] as Record<string, unknown>);

  const { rows: plotRows } = await pool.query(
    `SELECT * FROM plots WHERE farm_id = $1 AND deleted_at IS NULL ORDER BY name`,
    [farmUuid],
  );
  const { rows: subRows } = await pool.query(
    `SELECT * FROM subareas WHERE farm_id = $1 AND deleted_at IS NULL ORDER BY name`,
    [farmUuid],
  );
  const { rows: seasonRows } = await pool.query(
    `SELECT * FROM seasons WHERE farm_id = $1 AND deleted_at IS NULL ORDER BY name`,
    [farmUuid],
  );
  const { rows: cropRows } = await pool.query(
    `SELECT * FROM crops WHERE farm_id = $1 AND deleted_at IS NULL ORDER BY name`,
    [farmUuid],
  );

  const plotList = plotRows as Record<string, unknown>[];
  const plotIdToSubs = new Map<string, Record<string, unknown>[]>();
  for (const s of subRows as Record<string, unknown>[]) {
    const pid = String(s.plot_id);
    const arr = plotIdToSubs.get(pid) ?? [];
    arr.push({
      id: s.id,
      local_id: s.local_id,
      plot_local_id: s.plot_local_id,
      name: s.name,
      treatment_name: s.treatment_name,
      area_ha: s.area_ha,
      centroid_lat: s.centroid_lat,
      centroid_lng: s.centroid_lng,
      geojson: s.geojson,
      is_active: s.is_active,
      deleted_at: s.deleted_at,
      created_at: s.created_at,
      updated_at: s.updated_at,
    });
    plotIdToSubs.set(pid, arr);
  }

  const plots = plotList.map((p) => ({
    id: p.id,
    local_id: p.local_id,
    name: p.name,
    area_ha: p.area_ha,
    perimeter_m: p.perimeter_m,
    centroid_lat: p.centroid_lat,
    centroid_lng: p.centroid_lng,
    geojson: p.geojson,
    is_active: p.is_active,
    deleted_at: p.deleted_at,
    created_at: p.created_at,
    updated_at: p.updated_at,
    subareas: plotIdToSubs.get(String(p.id)) ?? [],
  }));

  const seasons = (seasonRows as Record<string, unknown>[]).map((r) => ({
    id: r.id,
    local_id: r.local_id,
    name: r.name,
    crop_name: r.crop_name,
    start_date: r.start_date,
    end_date: r.end_date,
    is_active: r.is_active,
    deleted_at: r.deleted_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  const crops = (cropRows as Record<string, unknown>[]).map((r) => ({
    id: r.id,
    local_id: r.local_id,
    name: r.name,
    scientific_name: r.scientific_name,
    family: r.family,
    description: r.description,
    is_active: r.is_active,
    deleted_at: r.deleted_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  let totalArea = 0;
  let hasArea = false;
  for (const p of plotList) {
    const a = p.area_ha;
    if (a != null && typeof a === 'number' && Number.isFinite(a)) {
      totalArea += a;
      hasArea = true;
    } else if (a != null) {
      const n = Number(a);
      if (Number.isFinite(n)) {
        totalArea += n;
        hasArea = true;
      }
    }
  }

  return {
    farm,
    plots,
    seasons,
    crops,
    summary: {
      plotsCount: plots.length,
      subareasCount: subRows.length,
      seasonsCount: seasons.length,
      cropsCount: crops.length,
      totalAreaHa: hasArea ? totalArea : null,
    },
  };
}
