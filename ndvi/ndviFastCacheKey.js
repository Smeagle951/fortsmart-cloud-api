import { createHash } from 'node:crypto';

/** Estados de artefato (skill FastCache V1) — disponibilidade, não sequência rígida. */
export const FASTCACHE_ARTIFACT_STATES = Object.freeze({
  DISCOVERED: 'DISCOVERED',
  PREVIEW_READY: 'PREVIEW_READY',
  MAP_READY: 'MAP_READY',
  ANALYTICS_READY: 'ANALYTICS_READY',
  EXPORT_READY: 'EXPORT_READY',
  FAILED: 'FAILED',
});

export function hashPolygonForPackage(polygon) {
  const raw = JSON.stringify(polygon?.coordinates ?? polygon ?? {});
  return createHash('sha256').update(raw).digest('hex').slice(0, 12);
}

/**
 * Chave persistente de pacote (tenant + geometria + cena + resolução + versões).
 * Separada de URLs temporárias GEE.
 */
export function buildFastCachePackageKey({
  farmId,
  plotId,
  sceneId,
  acquisitionDate,
  polygonHash,
  resolutionKind = 'preview',
  cloudMaskVersion = 'cloud_score_plus_v1',
  rendererVersion = 'spectral_objective_v1',
  objective = 'recommended',
  algorithmVersion = 'spectral_objective_v1',
  classificationVersion = 'post_harvest_v0.1',
  requestedDate,
  visualMode = null,
}) {
  const req = String(requestedDate || acquisitionDate || '').slice(0, 10);
  const base = [
    farmId,
    plotId,
    sceneId || '-',
    acquisitionDate || '-',
    polygonHash || '-',
    resolutionKind,
    cloudMaskVersion,
    rendererVersion,
    objective,
    algorithmVersion,
    classificationVersion,
    req,
  ].join('_');
  if (!visualMode) return base;
  return `${base}::${visualMode}`;
}

/** @deprecated use buildFastCachePackageKey — alias interno legado */
export const buildScenePackageKey = buildFastCachePackageKey;

function persistentPreviewUrl(layer) {
  const url = String(layer?.preview_url || layer?.previewUrl || '').trim();
  if (!url) return false;
  if (url.includes('earthengine.googleapis.com')) return false;
  if (url.includes('googleusercontent.com/maps')) return false;
  return true;
}

function hasGeoreference(layer, status) {
  const stats = layer?.agronomic_stats || layer?.agronomicStats || status?.agronomic_stats;
  const bbox = layer?.bbox || stats?.bbox || stats?.provenance?.bbox;
  const crs = layer?.crs || stats?.crs || stats?.provenance?.crs;
  return (
    Array.isArray(bbox) &&
    bbox.length === 4 &&
    bbox.every((v) => Number.isFinite(Number(v))) &&
    typeof crs === 'string' &&
    crs.trim().length > 0
  );
}

/**
 * Deriva estado FastCache a partir de layer + status HTTP do modo.
 */
export function resolveFastCacheArtifactState({ layer = null, status = null } = {}) {
  const statusText = String(status?.status || status?.layerStatus || '').toLowerCase();
  if (statusText === 'failed' || statusText === 'unavailable' || statusText === 'provider_error') {
    return FASTCACHE_ARTIFACT_STATES.FAILED;
  }

  const rasterUrl = layer?.raster_url || layer?.rasterUrl || layer?.raster_cache_path;
  const tileUrl = layer?.tile_url || layer?.tileUrl;
  const previewOk = persistentPreviewUrl(layer) || Boolean(status?.preview);
  const stats =
    layer?.agronomic_stats ||
    layer?.agronomicStats ||
    status?.agronomic_stats ||
    (layer?.ndvi_mean != null || layer?.ndviMean != null);

  if (rasterUrl && previewOk) {
    return FASTCACHE_ARTIFACT_STATES.EXPORT_READY;
  }
  if (stats && previewOk) {
    return FASTCACHE_ARTIFACT_STATES.ANALYTICS_READY;
  }
  if (tileUrl || (previewOk && hasGeoreference(layer, status))) {
    return FASTCACHE_ARTIFACT_STATES.MAP_READY;
  }
  if (previewOk) {
    return FASTCACHE_ARTIFACT_STATES.PREVIEW_READY;
  }
  if (statusText === 'ready' || statusText === 'generated') {
    return FASTCACHE_ARTIFACT_STATES.DISCOVERED;
  }
  return FASTCACHE_ARTIFACT_STATES.DISCOVERED;
}

export function enrichStatusesWithFastCacheArtifacts({
  statusesByMode = {},
  layersByMode = {},
  packageCacheKey = null,
}) {
  const artifactStates = {};
  const modes = new Set([
    ...Object.keys(statusesByMode || {}),
    ...Object.keys(layersByMode || {}),
  ]);
  for (const mode of modes) {
    const layer = layersByMode[mode] || null;
    const status = statusesByMode[mode] || null;
    const artifactState = resolveFastCacheArtifactState({ layer, status });
    artifactStates[mode] = artifactState;
    if (status && typeof status === 'object') {
      statusesByMode[mode] = {
        ...status,
        artifactState,
        fastCacheKey: packageCacheKey ? `${packageCacheKey}::${mode}` : null,
      };
    }
  }
  return {
    artifactStates,
    statusesByMode,
  };
}

export function buildFastCacheResponseMeta({
  packageCacheKey,
  artifactStates,
  fromCache = false,
  geeInvoked = false,
  totalMs = 0,
  requestId = null,
}) {
  return {
    version: 'fastcache_v1',
    packageCacheKey,
    fromCache,
    geeInvoked,
    artifactStates,
    totalMs,
    requestId,
  };
}
