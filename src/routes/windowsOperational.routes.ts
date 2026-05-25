import { Router } from 'express';
import { getPool } from '../db/pool.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { jsonOk } from '../utils/response.js';
import { requireApiKey } from '../middleware/apiKeyAuth.js';
import { loadWindowsOperational } from '../services/windowsOperational.service.js';
import { loadPlantingMapWindowsPayload } from '../services/windowsPlantingMap.service.js';
import type { OperationalModule } from '../validators/operationalSync.validator.js';
import { assertWindowsFarmScope } from '../lib/windowsFarmScope.js';
import { loadWindowsDecisionInsights } from '../services/windowsDecisionInsights.service.js';

export const windowsOperationalRouter = Router();

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function flattenPlantingWindowsPayload(plots: Record<string, unknown>[]): Record<string, unknown> {
  const plantings: Record<string, unknown>[] = [];
  const plantingHistory: Record<string, unknown>[] = [];
  const plantStand: Record<string, unknown>[] = [];
  const plantability: Record<string, unknown>[] = [];
  const subareas: Record<string, unknown>[] = [];
  const plotGeometries: Record<string, unknown>[] = [];
  const geoExportsAll: Record<string, unknown>[] = [];
  const images: Record<string, unknown>[] = [];

  for (const plot of plots) {
    const plotId = plot.plot_id ?? plot.id ?? null;
    const plotLocalId = plot.plot_local_id ?? plot.local_id ?? null;
    const plotName = plot.plot_name ?? plot.name ?? plot.nome ?? null;
    const plotGeojson = plot.plot_geojson ?? plot.geojson ?? plot.geometry ?? null;
    if (plotGeojson) {
      plotGeometries.push({
        plot_cloud_id: plotId,
        plot_local_id: plotLocalId,
        plot_name: plotName,
        geojson: plotGeojson,
      });
    }

    for (const sub of asArray(plot.subareas)) {
      const subarea = {
        ...sub,
        plot_cloud_id: sub.plot_cloud_id ?? plotId,
        plot_local_id: sub.plot_local_id ?? plotLocalId,
        plot_name: sub.plot_name ?? plotName,
      };
      subareas.push(subarea);

      for (const wrapped of asArray(sub.records)) {
        const planting = (wrapped.planting && typeof wrapped.planting === 'object' && !Array.isArray(wrapped.planting))
          ? (wrapped.planting as Record<string, unknown>)
          : wrapped;
        const enrichedPlanting = {
          ...planting,
          plot_cloud_id: planting.plot_cloud_id ?? plotId,
          plot_local_id: planting.plot_local_id ?? plotLocalId,
          plot_name: planting.plot_name ?? plotName,
          subarea_local_id: planting.subarea_local_id ?? sub.subarea_local_id,
          subarea_cloud_id: planting.subarea_cloud_id ?? sub.subarea_id,
          subarea_name: planting.subarea_name ?? sub.subarea_name,
        };
        plantings.push(enrichedPlanting);
        plantingHistory.push(enrichedPlanting);

        const standRows = asArray(wrapped.stand_evaluations);
        const cvRows = asArray(wrapped.cv_records);
        const geoRows = asArray(wrapped.geo_exports);
        const imageRows = asArray(wrapped.images);

        plantStand.push(...standRows.map((row) => ({ ...row, plot_cloud_id: row.plot_cloud_id ?? plotId, plot_local_id: row.plot_local_id ?? plotLocalId })));
        plantability.push(...cvRows.map((row) => ({ ...row, plot_cloud_id: row.plot_cloud_id ?? plotId, plot_local_id: row.plot_local_id ?? plotLocalId })));
        geoExportsAll.push(...geoRows.map((row) => ({ ...row, plot_cloud_id: row.plot_cloud_id ?? plotId, plot_local_id: row.plot_local_id ?? plotLocalId })));
        images.push(...imageRows);
      }
    }
  }

  return {
    plantings,
    planting_history: plantingHistory,
    plant_stand: plantStand,
    plantability,
    subareas,
    plot_geometries: plotGeometries,
    geo_exports_all: geoExportsAll,
    images,
  };
}

function flattenMonitoringWindowsPayload(plots: unknown[]): Record<string, unknown> {
  const reports: Record<string, unknown>[] = [];
  const points: Record<string, unknown>[] = [];
  const occurrences: Record<string, unknown>[] = [];
  const images: Record<string, unknown>[] = [];
  const organismsDetected: Record<string, unknown>[] = [];
  const recommendations: Record<string, unknown>[] = [];
  const integratedManagement: Record<string, unknown>[] = [];
  const economicImpacts: Record<string, unknown>[] = [];
  const standContexts: Record<string, unknown>[] = [];
  const environmentContexts: Record<string, unknown>[] = [];
  const plantingContexts: Record<string, unknown>[] = [];

  const pushUnique = (
    target: Record<string, unknown>[],
    items: unknown,
    enrich: Record<string, unknown>,
  ) => {
    if (!Array.isArray(items)) return;
    for (const raw of items) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      target.push({ ...(raw as Record<string, unknown>), ...enrich });
    }
  };

  for (const plot of asArray(plots)) {
    const plotId = plot.plot_id ?? plot.id ?? null;
    const plotLocalId = plot.plot_local_id ?? plot.local_id ?? null;
    const plotName = plot.plot_name ?? plot.name ?? plot.nome ?? null;
    for (const report of asArray(plot.timeline)) {
      const reportId = report.report_id ?? report.id ?? null;
      const reportLocalId = report.report_local_id ?? report.local_id ?? null;
      const enrichedReport = {
        ...report,
        plot_cloud_id: report.plot_cloud_id ?? plotId,
        plot_local_id: report.plot_local_id ?? plotLocalId,
        plot_name: report.plot_name ?? plotName,
      };
      reports.push(enrichedReport);
      const reportEnrich = {
        report_cloud_id: reportId,
        report_local_id: reportLocalId,
        plot_cloud_id: enrichedReport.plot_cloud_id,
        plot_local_id: enrichedReport.plot_local_id,
        plot_name: enrichedReport.plot_name,
      };
      pushUnique(organismsDetected, report.organisms_detected, reportEnrich);
      pushUnique(recommendations, report.recommendations, reportEnrich);
      pushUnique(integratedManagement, report.integrated_management, reportEnrich);
      pushUnique(economicImpacts, report.economic_impacts, reportEnrich);
      if (report.stand_context && typeof report.stand_context === 'object' && !Array.isArray(report.stand_context)) {
        const keys = Object.keys(report.stand_context as object);
        if (keys.length > 0) {
          standContexts.push({ ...(report.stand_context as Record<string, unknown>), ...reportEnrich });
        }
      }
      if (
        report.environment_context &&
        typeof report.environment_context === 'object' &&
        !Array.isArray(report.environment_context)
      ) {
        const keys = Object.keys(report.environment_context as object);
        if (keys.length > 0) {
          environmentContexts.push({
            ...(report.environment_context as Record<string, unknown>),
            ...reportEnrich,
          });
        }
      }
      if (
        report.planting_context &&
        typeof report.planting_context === 'object' &&
        !Array.isArray(report.planting_context)
      ) {
        const keys = Object.keys(report.planting_context as object);
        if (keys.length > 0) {
          plantingContexts.push({
            ...(report.planting_context as Record<string, unknown>),
            ...reportEnrich,
          });
        }
      }
      for (const point of asArray(report.points)) {
        const pointId = point.point_id ?? point.id ?? null;
        const pointLocalId = point.point_local_id ?? point.local_id ?? null;
        const enrichedPoint = {
          ...point,
          report_cloud_id: reportId,
          report_local_id: reportLocalId,
          plot_cloud_id: point.plot_cloud_id ?? plotId,
          plot_local_id: point.plot_local_id ?? plotLocalId,
        };
        points.push(enrichedPoint);
        for (const occurrence of asArray(point.occurrences)) {
          const occurrenceId = occurrence.occurrence_id ?? occurrence.id ?? null;
          const occurrenceLocalId = occurrence.occurrence_local_id ?? occurrence.local_id ?? null;
          const enrichedOccurrence = {
            ...occurrence,
            report_cloud_id: reportId,
            report_local_id: reportLocalId,
            point_cloud_id: pointId,
            point_local_id: pointLocalId,
            plot_cloud_id: occurrence.plot_cloud_id ?? plotId,
            plot_local_id: occurrence.plot_local_id ?? plotLocalId,
            latitude: occurrence.latitude ?? point.latitude,
            longitude: occurrence.longitude ?? point.longitude,
          };
          occurrences.push(enrichedOccurrence);
          for (const image of asArray(occurrence.images)) {
            images.push({
              ...image,
              report_cloud_id: reportId,
              report_local_id: reportLocalId,
              point_cloud_id: pointId,
              point_local_id: pointLocalId,
              occurrence_cloud_id: occurrenceId,
              occurrence_local_id: occurrenceLocalId,
              plot_cloud_id: image.plot_cloud_id ?? plotId,
              plot_local_id: image.plot_local_id ?? plotLocalId,
            });
          }
        }
      }
    }
  }

  const dashboardSummary =
    reports.length === 0
      ? {}
      : (reports[reports.length - 1]?.dashboard_summary as Record<string, unknown>) ?? {};

  return {
    reports,
    points,
    occurrences,
    images,
    organisms_detected: organismsDetected,
    recommendations,
    integrated_management: integratedManagement,
    economic_impacts: economicImpacts,
    stand_context: standContexts,
    environment_context: environmentContexts,
    planting_context: plantingContexts,
    dashboard_summary: dashboardSummary,
  };
}

/** Contrato unificado para planting + monitoring-report (desktop / curl). */
function normalizeOperationalWindowsData(
  module: OperationalModule,
  farmId: string,
  payload: Awaited<ReturnType<typeof loadWindowsOperational>>,
): Record<string, unknown> {
  if (module === 'planting') {
    const p = payload as {
      plots?: Record<string, unknown>[];
      summary?: Record<string, unknown>;
    };
    const plots = p.plots ?? [];
    const flat = flattenPlantingWindowsPayload(plots);
    return {
      farm_id: farmId,
      farm_cloud_id: farmId,
      summary: {
        total_plantings: 0,
        total_stand_evaluations: 0,
        total_cv_records: 0,
        total_phenology_records: 0,
        total_geo_exports: 0,
        total_calibration_records: 0,
        total_images: 0,
        latest_planting_date: null as string | null,
        ...(typeof p.summary === 'object' && p.summary ? p.summary : {}),
      },
      plots,
      ...flat,
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
    const flat = flattenMonitoringWindowsPayload(plots);
    const summaryFilled = {
      total_reports: 0,
      total_points: 0,
      total_occurrences: 0,
      critical_occurrences: 0,
      ...(typeof p.summary === 'object' && p.summary ? p.summary : {}),
      ...(p.diagnostics ? { diagnostics: p.diagnostics } : {}),
      ...(typeof flat.dashboard_summary === 'object' && flat.dashboard_summary
        ? flat.dashboard_summary
        : {}),
    };
    return {
      farm_id: farmId,
      farm_cloud_id: farmId,
      schema_version:
        (flat.reports as Record<string, unknown>[] | undefined)?.find((r) => r.schema_version)
          ?.schema_version ?? null,
      summary: summaryFilled,
      plots,
      ...flat,
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

windowsOperationalRouter.get(
  '/windows/planting-map/:farmId',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const farmId = assertWindowsFarmScope(req);
    const data = await loadPlantingMapWindowsPayload(getPool(), farmId);
    jsonOk(res, { data });
  }),
);

registerWindowGet('/windows/phenology/:farmId', 'phenology');
registerWindowGet('/windows/geo/:farmId', 'geo-export');

windowsOperationalRouter.get(
  '/windows/decision-insights/:farmId',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const farmId = assertWindowsFarmScope(req);
    const data = await loadWindowsDecisionInsights(getPool(), farmId);
    jsonOk(res, data);
  }),
);

windowsOperationalRouter.get(
  '/sync/diagnostics/:farmId',
  requireApiKey,
  asyncHandler(async (req, res) => {
    const farmId = assertWindowsFarmScope(req);
    const pool = getPool();
    const safeCount = async (table: string): Promise<number> => {
      try {
        const { rows } = await pool.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM ${table} WHERE farm_id = $1::uuid AND deleted_at IS NULL`,
          [farmId],
        );
        return Number(rows[0]?.count ?? 0);
      } catch {
        return 0;
      }
    };

    const safeScalar = async (sql: string, params: unknown[] = []): Promise<number> => {
      try {
        const { rows } = await pool.query<{ value: string }>(sql, params);
        return Number(rows[0]?.value ?? 0);
      } catch {
        return 0;
      }
    };

    const [
      plantings,
      stand,
      plantability,
      phenology,
      geojson,
      reports,
      points,
      occurrences,
      images,
      subareas,
      reportsV2,
      reportsWithOrganisms,
    ] = await Promise.all([
      safeCount('planting_records'),
      safeCount('plant_stand_records'),
      safeCount('planting_cv_records'),
      safeCount('phenology_records'),
      safeCount('geo_exports'),
      safeCount('monitoring_reports'),
      safeCount('monitoring_points'),
      safeCount('monitoring_occurrences'),
      safeCount('monitoring_images'),
      safeCount('subareas'),
      safeScalar(
        `SELECT COUNT(*)::text AS value FROM monitoring_reports
         WHERE farm_id = $1::uuid AND deleted_at IS NULL
           AND schema_version = 'monitoring_report_v2'`,
        [farmId],
      ),
      safeScalar(
        `SELECT COUNT(*)::text AS value FROM monitoring_reports
         WHERE farm_id = $1::uuid AND deleted_at IS NULL
           AND jsonb_array_length(COALESCE(organisms_detected, '[]'::jsonb)) > 0`,
        [farmId],
      ),
    ]);

    jsonOk(res, {
      farm_cloud_id: farmId,
      plantings,
      stand,
      cv_percent: plantability,
      plantability,
      phenology,
      subareas,
      reports,
      points,
      occurrences,
      images,
      geojson,
      monitoring_v2: {
        schema_version: 'monitoring_report_v2',
        reports_v2: reportsV2,
        reports_with_organisms: reportsWithOrganisms,
      },
      checked_at: new Date().toISOString(),
    });
  }),
);
