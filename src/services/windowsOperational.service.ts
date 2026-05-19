import type { Pool } from 'pg';
import { loadOperationalRows } from '../repositories/operationalSync.repository.js';
import { loadPlantingWindowsPayload } from '../repositories/plantingSync.repository.js';
import type { OperationalModule } from '../validators/operationalSync.validator.js';

export type WindowsOperationalPayload = {
  farm_id: string;
  module: OperationalModule;
  records: Record<string, unknown>[];
  /** Resumo agregado (plantio/monitoramento usam chaves diferentes). */
  summary: Record<string, unknown> & { total?: number };
  /** Presente em `/windows/planting` e `/windows/monitoring`. */
  plots?: Array<Record<string, unknown>>;
  diagnostics?: Record<string, unknown>;
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
    if (module === 'planting') {
      const data = await loadPlantingWindowsPayload(client, farmId);
      const summary = (data.summary as Record<string, unknown>) ?? {};
      const total = Number(summary.total_plantings ?? summary.total ?? 0);
      return {
        farm_id: farmId,
        module,
        records: [],
        plots: (data.plots as Array<Record<string, unknown>>) ?? [],
        summary: { ...summary, total },
      };
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
        p.id AS resolved_plot_id,
        p.local_id AS resolved_plot_local_id,
        COALESCE(NULLIF(TRIM(mr.plot_name), ''), NULLIF(TRIM(p.name), '')) AS resolved_plot_name,
        p.name AS resolved_plot_name_from_base,
        mr.subarea_local_id,
        mr.subarea_name,
        mr.crop_name,
        mr.report_date AS monitoring_date,
        mr.phenological_stage,
        mr.summary,
        mr.schema_version,
        mr.plot_geojson,
        mr.organisms_detected,
        mr.recommendations AS report_recommendations,
        mr.integrated_management,
        mr.economic_impacts,
        mr.stand_context,
        mr.environment_context,
        mr.planting_context,
        mr.dashboard_summary,
        mp.id AS point_id,
        mp.local_id AS point_local_id,
        mp.point_code,
        mp.latitude,
        mp.longitude,
        mo.id AS occurrence_id,
        mo.local_id AS occurrence_local_id,
        mo.type,
        mo.name,
        mo.scientific_name,
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
              'occurrence_id', mo.id,
              'monitoring_point_id', mp.id,
              'local_id', mi.local_id,
              'file_name', mi.file_name,
              'local_path', mi.local_path,
              'cloud_url', mi.cloud_url,
              'cloud_storage_key', mi.cloud_storage_key,
              'cloud_expires_at', mi.cloud_expires_at,
              'caption', mi.caption,
              'taken_at', mi.taken_at,
              'latitude', mi.latitude,
              'longitude', mi.longitude
            )
          ) FILTER (WHERE mi.id IS NOT NULL),
          '[]'::jsonb
        ) AS images
      FROM monitoring_reports mr
      LEFT JOIN plots p
        ON p.farm_id = mr.farm_id
       AND p.deleted_at IS NULL
       AND (
         p.id = mr.plot_cloud_id
         OR (mr.plot_local_id IS NOT NULL AND p.local_id = mr.plot_local_id)
       )
      LEFT JOIN monitoring_points mp ON mp.monitoring_report_id = mr.id AND mp.deleted_at IS NULL
      LEFT JOIN monitoring_occurrences mo ON mo.monitoring_point_id = mp.id AND mo.deleted_at IS NULL
      LEFT JOIN monitoring_recommendations mrp ON mrp.occurrence_id = mo.id
      LEFT JOIN monitoring_images mi ON mi.occurrence_id = mo.id OR (mi.occurrence_id IS NULL AND mi.monitoring_point_id = mp.id)
      WHERE mr.farm_id = $1 AND mr.deleted_at IS NULL
      GROUP BY
        mr.id, mp.id, mo.id, mrp.id, p.id,
        mr.schema_version, mr.plot_geojson, mr.organisms_detected,
        mr.recommendations, mr.integrated_management, mr.economic_impacts,
        mr.stand_context, mr.environment_context, mr.planting_context, mr.dashboard_summary
      ORDER BY mr.plot_name NULLS LAST, mr.report_date DESC NULLS LAST, mp.point_code NULLS LAST, mo.name NULLS LAST
    `,
    [farmId],
  );

  const plots = new Map<string, Record<string, unknown>>();
  const unresolvedPlotRefs = new Set<string>();

  for (const row of rows) {
    const resolvedPlotId = row.resolved_plot_id ?? row.plot_cloud_id ?? null;
    const resolvedPlotLocalId = row.plot_local_id ?? row.resolved_plot_local_id ?? null;
    const resolvedPlotName =
      row.resolved_plot_name ??
      row.resolved_plot_name_from_base ??
      (resolvedPlotLocalId ? `Talhao ${String(resolvedPlotLocalId)}` : 'Talhao sem nome');
    if (!resolvedPlotId && resolvedPlotLocalId) {
      unresolvedPlotRefs.add(String(resolvedPlotLocalId));
    }
    const plotKey = String(resolvedPlotId ?? resolvedPlotLocalId ?? 'sem-talhao');
    if (!plots.has(plotKey)) {
      plots.set(plotKey, {
        plot_id: resolvedPlotId,
        plot_local_id: resolvedPlotLocalId,
        plot_name: resolvedPlotName,
        plot_geojson: row.plot_geojson ?? null,
        timeline: [],
      });
    }
    const plot = plots.get(plotKey)!;
    const timeline = plot.timeline as Array<Record<string, unknown>>;
    let report = timeline.find((item) => item.report_id === row.report_id);
    if (!report) {
      report = {
        monitoring_date: row.monitoring_date,
        report_id: row.report_id,
        report_local_id: row.report_local_id,
        phenological_stage: row.phenological_stage,
        crop_name: row.crop_name,
        subarea_local_id: row.subarea_local_id,
        subarea_name: row.subarea_name,
        summary: row.summary ?? {},
        schema_version: row.schema_version ?? null,
        plot_geojson: row.plot_geojson ?? null,
        organisms_detected: row.organisms_detected ?? [],
        recommendations: row.report_recommendations ?? [],
        integrated_management: row.integrated_management ?? [],
        economic_impacts: row.economic_impacts ?? [],
        stand_context: row.stand_context ?? {},
        environment_context: row.environment_context ?? {},
        planting_context: row.planting_context ?? {},
        dashboard_summary: row.dashboard_summary ?? {},
        points: [],
      };
      timeline.push(report);
    }
    if (!row.point_id) continue;
    const reportPoints = report.points as Array<Record<string, unknown>>;
    let point = reportPoints.find((item) => item.point_id === row.point_id);
    if (!point) {
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
    const rowImages = Array.isArray(row.images) ? row.images : [];
    const pointOccurrences = point.occurrences as Array<Record<string, unknown>>;
    let occurrence = pointOccurrences.find((item) => item.occurrence_id === row.occurrence_id);
    if (!occurrence) {
      occurrence = {
        occurrence_id: row.occurrence_id,
        occurrence_local_id: row.occurrence_local_id,
        type: row.type,
        name: row.name,
        scientific_name: row.scientific_name,
        infestation_level: row.infestation_level,
        risk_level: row.risk_level,
        observations: row.observations,
        images: rowImages,
        recommendation: null,
      };
      pointOccurrences.push(occurrence);
    }
    if (row.simple_text) {
      occurrence.recommendation = {
        simple_text: row.simple_text,
        priority: row.priority,
        action_type: row.action_type,
      };
    }
  }

  if (unresolvedPlotRefs.size > 0) {
    console.warn(
      `[windows/monitoring] plot_id nao resolvido para ${unresolvedPlotRefs.size} plot_local_id(s): ${Array.from(unresolvedPlotRefs).join(', ')}`,
    );
  }

  const nonEmptyObject = (value: unknown): boolean =>
    !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length > 0;
  const normalizedPlots = Array.from(plots.values())
    .map((plot) => {
      const timeline = (plot.timeline as Array<Record<string, unknown>>).filter((report) => {
        const reportPoints = report.points as Array<Record<string, unknown>>;
        return reportPoints.length > 0 || nonEmptyObject(report.summary);
      });
      return { ...plot, timeline };
    })
    .filter((plot) => (plot.timeline as Array<unknown>).length > 0);

  let reports = 0;
  let points = 0;
  let occurrences = 0;
  let images = 0;
  for (const plot of normalizedPlots) {
    for (const report of plot.timeline as Array<Record<string, unknown>>) {
      reports += 1;
      for (const point of report.points as Array<Record<string, unknown>>) {
        points += 1;
        for (const occurrence of point.occurrences as Array<Record<string, unknown>>) {
          occurrences += 1;
          images += Array.isArray(occurrence.images) ? occurrence.images.length : 0;
        }
      }
    }
  }

  return {
    plots: normalizedPlots,
    diagnostics: {
      reports_loaded: reports,
      plots_with_occurrence: normalizedPlots.filter((plot) =>
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
