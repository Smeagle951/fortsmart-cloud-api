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
    if (module === 'monitoring-report') {
      const data = await loadMonitoringTimeline(client, farmId);
      return {
        farm_id: farmId,
        module,
        records: [],
        ...data,
      } as WindowsOperationalPayload & typeof data;
    }
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

async function loadMonitoringTimeline(
  client: import('pg').PoolClient,
  farmId: string,
): Promise<{
  plots: Array<Record<string, unknown>>;
  diagnostics: Record<string, unknown>;
  summary: { total: number; reports: number; points: number; occurrences: number; images: number };
}> {
  const { rows } = await client.query<Record<string, unknown>>(
    `
      SELECT
        mr.id AS report_id,
        mr.local_id AS report_local_id,
        mr.plot_local_id,
        mr.plot_cloud_id,
        mr.plot_name,
        mr.subarea_local_id,
        mr.subarea_name,
        mr.crop_name,
        mr.report_date AS monitoring_date,
        mr.phenological_stage,
        mr.summary,
        mp.id AS point_id,
        mp.local_id AS point_local_id,
        mp.point_code,
        mp.latitude,
        mp.longitude,
        mo.id AS occurrence_id,
        mo.local_id AS occurrence_local_id,
        mo.type,
        mo.name,
        mo.infestation_level,
        mo.risk_level,
        mo.observations,
        mrp.simple_text,
        mrp.priority,
        mrp.action_type,
        COALESCE(
          jsonb_agg(
            DISTINCT jsonb_build_object(
              'image_id', mi.id,
              'local_id', mi.local_id,
              'file_name', mi.file_name,
              'local_path', mi.local_path,
              'cloud_url', mi.cloud_url,
              'caption', mi.caption,
              'taken_at', mi.taken_at,
              'latitude', mi.latitude,
              'longitude', mi.longitude
            )
          ) FILTER (WHERE mi.id IS NOT NULL),
          '[]'::jsonb
        ) AS images
      FROM monitoring_reports mr
      LEFT JOIN monitoring_points mp ON mp.monitoring_report_id = mr.id AND mp.deleted_at IS NULL
      LEFT JOIN monitoring_occurrences mo ON mo.monitoring_point_id = mp.id AND mo.deleted_at IS NULL
      LEFT JOIN monitoring_recommendations mrp ON mrp.occurrence_id = mo.id
      LEFT JOIN monitoring_images mi ON mi.occurrence_id = mo.id OR (mi.occurrence_id IS NULL AND mi.monitoring_point_id = mp.id)
      WHERE mr.farm_id = $1 AND mr.deleted_at IS NULL
      GROUP BY mr.id, mp.id, mo.id, mrp.id
      ORDER BY mr.plot_name NULLS LAST, mr.report_date DESC NULLS LAST, mp.point_code NULLS LAST, mo.name NULLS LAST
    `,
    [farmId],
  );

  const plots = new Map<string, Record<string, unknown>>();
  let reports = 0;
  let points = 0;
  let occurrences = 0;
  let images = 0;

  for (const row of rows) {
    const plotKey = String(row.plot_cloud_id ?? row.plot_local_id ?? 'sem-talhao');
    if (!plots.has(plotKey)) {
      plots.set(plotKey, {
        plot_id: row.plot_cloud_id ?? null,
        plot_local_id: row.plot_local_id ?? null,
        plot_name: row.plot_name ?? 'Talhao sem nome',
        timeline: [],
      });
    }
    const plot = plots.get(plotKey)!;
    const timeline = plot.timeline as Array<Record<string, unknown>>;
    let report = timeline.find((item) => item.report_id === row.report_id);
    if (!report) {
      reports += 1;
      report = {
        monitoring_date: row.monitoring_date,
        report_id: row.report_id,
        report_local_id: row.report_local_id,
        phenological_stage: row.phenological_stage,
        crop_name: row.crop_name,
        subarea_local_id: row.subarea_local_id,
        subarea_name: row.subarea_name,
        summary: row.summary ?? {},
        points: [],
      };
      timeline.push(report);
    }
    if (!row.point_id) continue;
    const reportPoints = report.points as Array<Record<string, unknown>>;
    let point = reportPoints.find((item) => item.point_id === row.point_id);
    if (!point) {
      points += 1;
      point = {
        point_id: row.point_id,
        point_local_id: row.point_local_id,
        point_code: row.point_code,
        latitude: row.latitude,
        longitude: row.longitude,
        occurrences: [],
      };
      reportPoints.push(point);
    }
    if (!row.occurrence_id) continue;
    occurrences += 1;
    const rowImages = Array.isArray(row.images) ? row.images : [];
    images += rowImages.length;
    (point.occurrences as Array<Record<string, unknown>>).push({
      occurrence_id: row.occurrence_id,
      occurrence_local_id: row.occurrence_local_id,
      type: row.type,
      name: row.name,
      infestation_level: row.infestation_level,
      risk_level: row.risk_level,
      observations: row.observations,
      images: rowImages,
      recommendation: row.simple_text
        ? {
            simple_text: row.simple_text,
            priority: row.priority,
            action_type: row.action_type,
          }
        : null,
    });
  }

  return {
    plots: Array.from(plots.values()),
    diagnostics: {
      reports_loaded: reports,
      plots_with_occurrence: Array.from(plots.values()).filter((plot) =>
        (plot.timeline as Array<Record<string, unknown>>).some((report) =>
          (report.points as Array<Record<string, unknown>>).some(
            (point) => (point.occurrences as Array<unknown>).length > 0,
          ),
        ),
      ).length,
      points_loaded: points,
      occurrences_loaded: occurrences,
      images_loaded: images,
      last_update: new Date().toISOString(),
    },
    summary: { total: reports, reports, points, occurrences, images },
  };
}
