import type { Pool } from 'pg';
import {
  listDecisionInsightsByFarm,
  type DecisionInsightRow,
} from '../repositories/decisionInsightsSync.repository.js';

function num(value: string | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeRiskLevel(level: string | null): string {
  const s = (level ?? '').toLowerCase().trim();
  if (s.includes('crit')) return 'critico';
  if (s.includes('alt') || s.includes('high')) return 'alto';
  if (s.includes('med')) return 'medio';
  if (s.includes('baix') || s.includes('low')) return 'baixo';
  return s || 'desconhecido';
}

function isHighRisk(level: string): boolean {
  return level === 'alto';
}

function isCriticalRisk(level: string): boolean {
  return level === 'critico';
}

function organismLabel(row: DecisionInsightRow): string | null {
  const snap = row.decision_engine_snapshot_json as Record<string, unknown> | null;
  const source = snap?.source as Record<string, unknown> | undefined;
  return (
    source?.subtipo?.toString() ??
    source?.organism_name?.toString() ??
    row.organism_id
  );
}

function roiFromRow(row: DecisionInsightRow): number | null {
  const econ = row.economic_analysis_json as Record<string, unknown> | null;
  if (!econ || typeof econ !== 'object') return null;
  const presc = econ.prescription as Record<string, unknown> | undefined;
  const raw = presc?.roi_multiple ?? econ.roi_multiple;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function mapRowToDesktopDto(row: DecisionInsightRow): Record<string, unknown> {
  const evidence = Array.isArray(row.evidence_json) ? row.evidence_json : [];
  const snapshot =
    row.decision_engine_snapshot_json &&
    typeof row.decision_engine_snapshot_json === 'object' &&
    !Array.isArray(row.decision_engine_snapshot_json)
      ? row.decision_engine_snapshot_json
      : {};
  const economic =
    row.economic_analysis_json &&
    typeof row.economic_analysis_json === 'object' &&
    !Array.isArray(row.economic_analysis_json)
      ? row.economic_analysis_json
      : {};

  return {
    id: row.id,
    localId: row.local_id,
    farmCloudId: row.farm_cloud_id,
    farmLocalId: row.farm_local_id,
    talhaoLocalId: row.talhao_local_id,
    talhaoCloudId: row.talhao_cloud_id,
    safraId: row.safra_id,
    cultureId: row.culture_id,
    organismId: row.organism_id,
    sourceModule: row.source_module,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    monitoringSessionId: row.monitoring_session_id,
    monitoringOccurrenceId: row.monitoring_occurrence_id,
    monitoringPointId: row.monitoring_point_id,
    prescriptionId: row.prescription_id,
    riskLevel: normalizeRiskLevel(row.risk_level),
    riskScore: num(row.risk_score),
    estimatedLossScHa: num(row.estimated_loss_sc_ha),
    estimatedLossBrlHa: num(row.estimated_loss_brl_ha),
    estimatedTotalLossBrl: num(row.estimated_total_loss_brl),
    actionWindowHours: num(row.action_window_hours),
    recommendation: row.recommendation,
    confidencePercent: num(row.confidence_percent),
    evidenceJson: evidence,
    decisionEngineSnapshotJson: snapshot,
    economicAnalysisJson: economic,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
    bestRoiMultiple: roiFromRow(row),
    mainOrganismName: organismLabel(row),
  };
}

type PlotAgg = {
  plotId: string;
  plotCloudId: string | null;
  plotName: string | null;
  riskLevel: string;
  riskScore: number;
  totalEstimatedLossBrl: number;
  maxLossBrlHa: number;
  mainCause: string | null;
  mainOrganismName: string | null;
  recommendation: string | null;
  bestRoiMultiple: number | null;
  insightCount: number;
  highRiskCount: number;
  criticalRiskCount: number;
};

const riskRank: Record<string, number> = {
  critico: 4,
  alto: 3,
  medio: 2,
  baixo: 1,
  desconhecido: 0,
};

function plotKey(row: DecisionInsightRow): string {
  return row.talhao_cloud_id ?? row.talhao_local_id ?? 'unknown';
}

export async function loadWindowsDecisionInsights(
  pool: Pool,
  farmCloudId: string,
): Promise<Record<string, unknown>> {
  const rows = await listDecisionInsightsByFarm(pool, farmCloudId);
  const decisionInsights = rows.map(mapRowToDesktopDto);

  const byPlot = new Map<string, PlotAgg>();
  let totalEstimatedLossBrl = 0;
  let highRiskCount = 0;
  let criticalRiskCount = 0;
  let maxLossBrlHa = 0;
  let maxLossTotalBrl = 0;

  for (const row of rows) {
    const level = normalizeRiskLevel(row.risk_level);
    const score = num(row.risk_score);
    const lossHa = num(row.estimated_loss_brl_ha);
    const lossTotal = num(row.estimated_total_loss_brl);
    totalEstimatedLossBrl += lossTotal;
    if (isHighRisk(level)) highRiskCount++;
    if (isCriticalRisk(level)) criticalRiskCount++;
    if (lossHa > maxLossBrlHa) maxLossBrlHa = lossHa;
    if (lossTotal > maxLossTotalBrl) maxLossTotalBrl = lossTotal;

    const key = plotKey(row);
    const agg =
      byPlot.get(key) ??
      {
        plotId: row.talhao_local_id ?? key,
        plotCloudId: row.talhao_cloud_id,
        plotName: row.talhao_local_id,
        riskLevel: level,
        riskScore: score,
        totalEstimatedLossBrl: 0,
        maxLossBrlHa: 0,
        mainCause: row.source_id,
        mainOrganismName: organismLabel(row),
        recommendation: row.recommendation,
        bestRoiMultiple: roiFromRow(row),
        insightCount: 0,
        highRiskCount: 0,
        criticalRiskCount: 0,
      };

    agg.insightCount++;
    agg.totalEstimatedLossBrl += lossTotal;
    if (lossHa > agg.maxLossBrlHa) agg.maxLossBrlHa = lossHa;
    if ((riskRank[level] ?? 0) > (riskRank[agg.riskLevel] ?? 0)) {
      agg.riskLevel = level;
      agg.riskScore = score;
      agg.mainOrganismName = organismLabel(row);
      agg.recommendation = row.recommendation;
      agg.mainCause = row.source_id;
    } else if (score > agg.riskScore) {
      agg.riskScore = score;
    }
    if (isHighRisk(level)) agg.highRiskCount++;
    if (isCriticalRisk(level)) agg.criticalRiskCount++;
    const roi = roiFromRow(row);
    if (roi != null && (agg.bestRoiMultiple == null || roi > agg.bestRoiMultiple)) {
      agg.bestRoiMultiple = roi;
    }
    byPlot.set(key, agg);
  }

  const topRiskPlots = [...byPlot.values()]
    .sort((a, b) => b.totalEstimatedLossBrl - a.totalEstimatedLossBrl)
    .slice(0, 10)
    .map((p) => ({
      plotId: p.plotId,
      plotCloudId: p.plotCloudId,
      plotName: p.plotName ?? p.plotId,
      riskLevel: p.riskLevel,
      riskScore: p.riskScore,
      totalEstimatedLossBrl: p.totalEstimatedLossBrl,
      maxLossBrlHa: p.maxLossBrlHa,
      mainOrganismName: p.mainOrganismName,
      recommendation: p.recommendation,
      bestRoiMultiple: p.bestRoiMultiple,
      insightCount: p.insightCount,
      highRiskCount: p.highRiskCount,
      criticalRiskCount: p.criticalRiskCount,
    }));

  return {
    farm_id: farmCloudId,
    farm_cloud_id: farmCloudId,
    decisionInsights,
    summary: {
      totalEstimatedLossBrl,
      highRiskCount,
      criticalRiskCount,
      maxLossBrlHa,
      maxLossTotalBrl,
      topRiskPlots,
      insightCount: rows.length,
      plotCount: byPlot.size,
    },
  };
}
