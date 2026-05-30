function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 3) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function sceneDate(scene) {
  const raw = scene?.image_date ?? scene?.imageDate;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export function buildNdviTemporalIntelligence(scenes = []) {
  const ready = scenes
    .map((scene) => ({
      scene,
      date: sceneDate(scene),
      mean: num(scene.ndvi_mean ?? scene.ndviMean),
      belowP25: num(
        scene.percentBelowP25 ??
          scene.percent_below_p25 ??
          scene.spatial_metrics?.percentBelowP25,
      ),
      homogeneity: num(
        scene.homogeneity_score ??
          scene.homogeneityScore ??
          scene.spatial_metrics?.homogeneityScore,
      ),
      contrastScore: num(scene.spatial_metrics?.contrastScore),
    }))
    .filter((entry) => entry.date && entry.mean != null)
    .sort((a, b) => a.date - b.date);

  if (ready.length < 2) {
    return {
      status: 'insufficient_history',
      meanTrend30d: null,
      lowVigorTrend: null,
      persistentLowZone: false,
      expandingLowVigorZone: false,
      recoveryTrend: false,
    };
  }

  const latest = ready[ready.length - 1];
  const previous =
    [...ready]
      .reverse()
      .find((entry) => latest.date - entry.date >= 7 * 24 * 60 * 60 * 1000) ??
    ready[ready.length - 2];
  const meanTrend30d = round(latest.mean - previous.mean);
  const lowVigorTrend =
    latest.belowP25 != null && previous.belowP25 != null
      ? round(latest.belowP25 - previous.belowP25, 1)
      : null;
  const temporalDecline = meanTrend30d != null && meanTrend30d <= -0.05;
  const expandingLowVigorZone = lowVigorTrend != null && lowVigorTrend >= 8;
  const recoveryTrend =
    meanTrend30d != null &&
    meanTrend30d > 0.03 &&
    lowVigorTrend != null &&
    lowVigorTrend <= -5;
  const persistentLowZone =
    ready.length >= 3 &&
    ready.slice(-3).every((entry) => entry.belowP25 != null && entry.belowP25 >= 20);

  let status = 'stable';
  if (recoveryTrend) status = 'recovering';
  else if (temporalDecline && expandingLowVigorZone) status = 'worsening';
  else if (temporalDecline) status = 'declining';

  return {
    meanTrend30d,
    lowVigorTrend,
    persistentLowZone,
    expandingLowVigorZone,
    recoveryTrend,
    temporalDecline,
    status,
  };
}
