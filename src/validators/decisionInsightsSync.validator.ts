import { HttpError } from '../middleware/errorHandler.js';
import { isCloudFarmUuid } from '../lib/cloudFarmUuid.js';

export type DecisionInsightPushItem = Record<string, unknown>;

export type DecisionInsightPushBody = {
  device_id?: string;
  farm_local_id: string;
  farm_cloud_id: string;
  items: DecisionInsightPushItem[];
};

function requireStr(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(`${field} is required`, 400);
  }
  return value.trim();
}

function optStr(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function optNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function optJson(value: unknown): Record<string, unknown> | unknown[] | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as Record<string, unknown> | unknown[];
  if (typeof value === 'string' && value.trim()) {
    try {
      return JSON.parse(value) as Record<string, unknown> | unknown[];
    } catch {
      return null;
    }
  }
  return null;
}

function parseIso(value: unknown): string | null {
  if (value == null) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseDecisionInsightsPushBody(raw: unknown): DecisionInsightPushBody {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new HttpError('Invalid JSON body', 400);
  }
  const o = raw as Record<string, unknown>;
  const farmCloudId = requireStr(o.farm_cloud_id, 'farm_cloud_id');
  if (!isCloudFarmUuid(farmCloudId)) {
    throw new HttpError('farm_cloud_id must be a valid UUID', 400);
  }
  const itemsRaw = o.items;
  if (!Array.isArray(itemsRaw)) {
    throw new HttpError('items must be an array', 400);
  }
  const items = itemsRaw.filter(
    (item): item is DecisionInsightPushItem =>
      typeof item === 'object' && item !== null && !Array.isArray(item),
  );
  if (items.length === 0) {
    throw new HttpError('items must contain at least one insight', 400);
  }
  for (let i = 0; i < items.length; i++) {
    validatePushItem(items[i], i);
  }
  return {
    device_id: optStr(o.device_id) ?? undefined,
    farm_local_id: requireStr(o.farm_local_id, 'farm_local_id'),
    farm_cloud_id: farmCloudId,
    items,
  };
}

function validatePushItem(item: DecisionInsightPushItem, index: number): void {
  const prefix = `items[${index}]`;
  requireStr(item.local_id, `${prefix}.local_id`);
  const talhao =
    optStr(item.talhao_local_id) ?? optStr(item.talhaoLocalId);
  if (!talhao) {
    throw new HttpError(`${prefix}.talhao_local_id is required`, 400);
  }
  const sourceId = optStr(item.source_id) ?? optStr(item.sourceId);
  if (!sourceId) {
    throw new HttpError(`${prefix}.source_id is required`, 400);
  }
  const hasPayload =
    (optNum(item.estimated_loss_brl_ha) ?? 0) > 0 ||
    (optNum(item.estimated_total_loss_brl) ?? 0) > 0 ||
    (optNum(item.estimated_loss_sc_ha) ?? 0) > 0 ||
    (optNum(item.risk_score) ?? 0) > 0 ||
    (optStr(item.recommendation)?.length ?? 0) > 0;
  if (!hasPayload) {
    throw new HttpError(
      `${prefix} must include loss, risk_score or recommendation`,
      400,
    );
  }
}

export function normalizePushItem(
  item: DecisionInsightPushItem,
): Record<string, unknown> {
  const prescription =
    item.prescription && typeof item.prescription === 'object' && !Array.isArray(item.prescription)
      ? (item.prescription as Record<string, unknown>)
      : null;

  let economic = optJson(item.economic_analysis_json);
  if (economic && !Array.isArray(economic) && typeof economic === 'object') {
    economic = economic as Record<string, unknown>;
  } else {
    economic = {};
  }
  if (prescription) {
    (economic as Record<string, unknown>).prescription = prescription;
    if (!('prescription_id' in (economic as object)) && prescription.id) {
      (economic as Record<string, unknown>).prescription_id = prescription.id;
    }
  }

  const evidence = optJson(item.evidence_json);
  const snapshot = optJson(item.decision_engine_snapshot_json);

  return {
    local_id: requireStr(item.local_id, 'local_id'),
    talhao_local_id: optStr(item.talhao_local_id) ?? optStr(item.talhaoLocalId),
    talhao_cloud_id: optStr(item.talhao_cloud_id) ?? optStr(item.talhaoCloudId),
    safra_id: optStr(item.safra_id) ?? optStr(item.safraId),
    culture_id: optStr(item.culture_id) ?? optStr(item.cultureId),
    organism_id: optStr(item.organism_id) ?? optStr(item.organismId),
    source_module: optStr(item.source_module) ?? optStr(item.sourceModule) ?? 'monitoring',
    source_table:
      optStr(item.source_table) ??
      optStr(item.sourceTable) ??
      'monitoring_economic_history',
    source_id: optStr(item.source_id) ?? optStr(item.sourceId),
    monitoring_session_id:
      optStr(item.monitoring_session_id) ?? optStr(item.monitoringSessionId),
    monitoring_occurrence_id:
      optStr(item.monitoring_occurrence_id) ?? optStr(item.monitoringOccurrenceId),
    monitoring_point_id:
      optStr(item.monitoring_point_id) ?? optStr(item.monitoringPointId),
    prescription_id:
      optStr(item.prescription_id) ??
      optStr(item.prescriptionId) ??
      (prescription ? optStr(prescription.id) : null),
    risk_level: optStr(item.risk_level) ?? optStr(item.riskLevel) ?? 'desconhecido',
    risk_score: optNum(item.risk_score) ?? optNum(item.riskScore) ?? 0,
    estimated_loss_sc_ha:
      optNum(item.estimated_loss_sc_ha) ?? optNum(item.estimatedLossScHa),
    estimated_loss_brl_ha:
      optNum(item.estimated_loss_brl_ha) ?? optNum(item.estimatedLossBrlHa),
    estimated_total_loss_brl:
      optNum(item.estimated_total_loss_brl) ?? optNum(item.estimatedTotalLossBrl),
    action_window_hours:
      optNum(item.action_window_hours) ?? optNum(item.actionWindowHours),
    recommendation: optStr(item.recommendation),
    confidence_percent:
      optNum(item.confidence_percent) ?? optNum(item.confidencePercent),
    evidence_json: Array.isArray(evidence) ? evidence : evidence ? [evidence] : [],
    decision_engine_snapshot_json:
      snapshot && !Array.isArray(snapshot) ? snapshot : {},
    economic_analysis_json: economic,
    created_at: parseIso(item.created_at) ?? parseIso(item.createdAt),
    updated_at: parseIso(item.updated_at) ?? parseIso(item.updatedAt),
  };
}
