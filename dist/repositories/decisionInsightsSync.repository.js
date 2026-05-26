export async function upsertDecisionInsight(client, farmCloudId, farmLocalId, row) {
    const localId = String(row.local_id);
    const incomingUpdated = row.updated_at ? new Date(String(row.updated_at)) : null;
    const { rows: existing } = await client.query(`SELECT updated_at FROM decision_insights
     WHERE farm_cloud_id = $1::uuid AND local_id = $2`, [farmCloudId, localId]);
    if (existing.length > 0 && incomingUpdated) {
        const current = existing[0].updated_at
            ? new Date(existing[0].updated_at)
            : null;
        if (current && !Number.isNaN(current.getTime()) && current > incomingUpdated) {
            return 'skipped';
        }
    }
    const params = [
        farmCloudId,
        farmLocalId,
        localId,
        row.talhao_local_id ?? null,
        row.talhao_cloud_id ?? null,
        row.safra_id ?? null,
        row.culture_id ?? null,
        row.organism_id ?? null,
        row.source_module ?? null,
        row.source_table ?? null,
        row.source_id ?? null,
        row.monitoring_session_id ?? null,
        row.monitoring_occurrence_id ?? null,
        row.monitoring_point_id ?? null,
        row.prescription_id ?? null,
        row.risk_level ?? null,
        row.risk_score ?? 0,
        row.estimated_loss_sc_ha ?? null,
        row.estimated_loss_brl_ha ?? null,
        row.estimated_total_loss_brl ?? null,
        row.action_window_hours ?? null,
        row.recommendation ?? null,
        row.confidence_percent ?? null,
        JSON.stringify(row.evidence_json ?? []),
        JSON.stringify(row.decision_engine_snapshot_json ?? {}),
        JSON.stringify(row.economic_analysis_json ?? {}),
        row.created_at ?? new Date().toISOString(),
        row.updated_at ?? new Date().toISOString(),
    ];
    const existed = existing.length > 0;
    await client.query(`INSERT INTO decision_insights (
      farm_cloud_id, farm_local_id, local_id,
      talhao_local_id, talhao_cloud_id, safra_id, culture_id, organism_id,
      source_module, source_table, source_id,
      monitoring_session_id, monitoring_occurrence_id, monitoring_point_id,
      prescription_id, risk_level, risk_score,
      estimated_loss_sc_ha, estimated_loss_brl_ha, estimated_total_loss_brl,
      action_window_hours, recommendation, confidence_percent,
      evidence_json, decision_engine_snapshot_json, economic_analysis_json,
      created_at, updated_at, synced_at
    ) VALUES (
      $1::uuid, $2, $3,
      $4, $5, $6, $7, $8,
      $9, $10, $11,
      $12, $13, $14,
      $15, $16, $17,
      $18, $19, $20,
      $21, $22, $23,
      $24::jsonb, $25::jsonb, $26::jsonb,
      COALESCE($27::timestamptz, NOW()), COALESCE($28::timestamptz, NOW()), NOW()
    )
    ON CONFLICT (farm_cloud_id, local_id) DO UPDATE SET
      farm_local_id = EXCLUDED.farm_local_id,
      talhao_local_id = EXCLUDED.talhao_local_id,
      talhao_cloud_id = EXCLUDED.talhao_cloud_id,
      safra_id = EXCLUDED.safra_id,
      culture_id = EXCLUDED.culture_id,
      organism_id = EXCLUDED.organism_id,
      source_module = EXCLUDED.source_module,
      source_table = EXCLUDED.source_table,
      source_id = EXCLUDED.source_id,
      monitoring_session_id = EXCLUDED.monitoring_session_id,
      monitoring_occurrence_id = EXCLUDED.monitoring_occurrence_id,
      monitoring_point_id = EXCLUDED.monitoring_point_id,
      prescription_id = EXCLUDED.prescription_id,
      risk_level = EXCLUDED.risk_level,
      risk_score = EXCLUDED.risk_score,
      estimated_loss_sc_ha = EXCLUDED.estimated_loss_sc_ha,
      estimated_loss_brl_ha = EXCLUDED.estimated_loss_brl_ha,
      estimated_total_loss_brl = EXCLUDED.estimated_total_loss_brl,
      action_window_hours = EXCLUDED.action_window_hours,
      recommendation = EXCLUDED.recommendation,
      confidence_percent = EXCLUDED.confidence_percent,
      evidence_json = EXCLUDED.evidence_json,
      decision_engine_snapshot_json = EXCLUDED.decision_engine_snapshot_json,
      economic_analysis_json = EXCLUDED.economic_analysis_json,
      updated_at = EXCLUDED.updated_at,
      synced_at = NOW()`, params);
    return existed ? 'updated' : 'inserted';
}
export async function listDecisionInsightsByFarm(pool, farmCloudId) {
    const { rows } = await pool.query(`SELECT *
     FROM decision_insights
     WHERE farm_cloud_id = $1::uuid
     ORDER BY COALESCE(updated_at, synced_at, created_at) DESC`, [farmCloudId]);
    return rows;
}
//# sourceMappingURL=decisionInsightsSync.repository.js.map