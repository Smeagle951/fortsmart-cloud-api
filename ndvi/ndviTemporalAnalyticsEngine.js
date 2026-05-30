/**
 * Analytics temporal enterprise a partir de histórico de camadas NDVI.
 */
import { buildNdviTemporalIntelligence } from './ndviTemporalIntelligenceEngine.js';

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 3) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

export function buildNdviTemporalAnalytics(history = []) {
  const base = buildNdviTemporalIntelligence(history);
  const sorted = [...history]
    .filter((h) => h?.image_date || h?.imageDate)
    .sort(
      (a, b) =>
        new Date(a.image_date || a.imageDate) - new Date(b.image_date || b.imageDate),
    );

  const latest = sorted.at(-1);
  const d30 = sorted.filter((h) => {
    const d = new Date(h.image_date || h.imageDate);
    const ref = new Date(latest?.image_date || latest?.imageDate || Date.now());
    return ref - d <= 30 * 24 * 60 * 60 * 1000;
  });
  const d60 = sorted.filter((h) => {
    const d = new Date(h.image_date || h.imageDate);
    const ref = new Date(latest?.image_date || latest?.imageDate || Date.now());
    return ref - d <= 60 * 24 * 60 * 60 * 1000;
  });

  const delta = (rows) => {
    if (rows.length < 2) return null;
    const first = num(rows[0].ndvi_mean ?? rows[0].ndviMean);
    const last = num(rows.at(-1).ndvi_mean ?? rows.at(-1).ndviMean);
    return first != null && last != null ? round(last - first) : null;
  };

  const ndmiTrend = sorted
    .map((h) => num(h.ndmi_mean ?? h.ndmiMean))
    .filter((v) => v != null);
  const ndreTrend = sorted
    .map((h) => num(h.ndre_mean ?? h.ndreMean))
    .filter((v) => v != null);

  const ndmiDelta =
    ndmiTrend.length >= 2 ? round(ndmiTrend.at(-1) - ndmiTrend[0]) : null;
  const ndreDelta =
    ndreTrend.length >= 2 ? round(ndreTrend.at(-1) - ndreTrend[0]) : null;

  const stabilityScore =
    base.homogeneityTrend != null
      ? round(Math.max(0, Math.min(100, 100 - Math.abs(base.meanTrend30d ?? 0) * 200)), 1)
      : null;

  return {
    trend: base.status,
    ndviDelta30d: delta(d30),
    ndviDelta60d: delta(d60),
    lowZonePersistence: base.persistentLowZone,
    recoveringZones: base.recoveryTrend,
    degradingZones: base.temporalDecline && base.expandingLowVigorZone,
    stabilityScore,
    ndmiTrend: ndmiDelta,
    ndreTrend: ndreDelta,
    temporalDecline: base.temporalDecline,
    expandingLowVigorZone: base.expandingLowVigorZone,
    status: base.status,
  };
}
