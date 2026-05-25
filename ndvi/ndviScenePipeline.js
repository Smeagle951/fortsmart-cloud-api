import { toIsoDate } from './ndviResponse.mapper.js';

const PROVIDER_LABEL = 'copernicus_dataspace';

/**
 * Uma cena por data de aquisição (menor cobertura de nuvens vence).
 */
export function dedupeScenesByDate(scenes) {
  const byDate = new Map();

  for (const scene of scenes) {
    const date = toIsoDate(scene.image_date);
    if (!date) continue;

    const existing = byDate.get(date);
    if (!existing) {
      byDate.set(date, scene);
      continue;
    }

    const cloudExisting = Number(existing.cloud_coverage ?? 999);
    const cloudNew = Number(scene.cloud_coverage ?? 999);
    if (cloudNew < cloudExisting) {
      byDate.set(date, scene);
    }
  }

  return Array.from(byDate.values());
}

/** Mais recente primeiro; empate por menor nuvem. */
export function sortScenesForDisplay(scenes) {
  return [...scenes].sort((a, b) => {
    const dateCmp = String(b.image_date || '').localeCompare(String(a.image_date || ''));
    if (dateCmp !== 0) return dateCmp;
    const cloudA = Number(a.cloud_coverage ?? 999);
    const cloudB = Number(b.cloud_coverage ?? 999);
    return cloudA - cloudB;
  });
}

export function enrichScenesFromLayers(scenes, layers) {
  const bySceneId = new Map();
  const byDate = new Map();

  for (const layer of layers || []) {
    if (layer.scene_id) bySceneId.set(String(layer.scene_id), layer);
    const date = toIsoDate(layer.image_date);
    if (date) {
      const prev = byDate.get(date);
      if (!prev || String(layer.updated_at) > String(prev.updated_at)) {
        byDate.set(date, layer);
      }
    }
  }

  return scenes.map((scene) => {
    const layer =
      bySceneId.get(String(scene.scene_id || scene.id)) ||
      byDate.get(toIsoDate(scene.image_date));

    if (!layer) return { ...scene, provider: scene.provider || PROVIDER_LABEL };

    return {
      ...scene,
      provider: layer.provider || scene.provider || PROVIDER_LABEL,
      preview_url: layer.preview_url || scene.preview_url || scene.thumbnail_url,
      tile_url: layer.tile_url || scene.tile_url,
      raster_url: layer.raster_url || scene.raster_url,
      ndvi_mean: layer.ndvi_mean ?? scene.ndvi_mean,
      ndvi_min: layer.ndvi_min ?? scene.ndvi_min,
      ndvi_max: layer.ndvi_max ?? scene.ndvi_max,
      cloud_coverage: layer.cloud_coverage ?? scene.cloud_coverage,
      layer_id: layer.id,
      layer_status: layer.status,
    };
  });
}

/**
 * Status compatível com o app Flutter (sem "available" falso quando não há imagem).
 */
export function resolveSceneStatus(scene) {
  const storedStatus = String(scene.layer_status || '').toLowerCase();
  if (storedStatus === 'failed') return 'failed';

  const preview = pickUrl(scene.preview_url, scene.thumbnail_url);
  const tile = pickUrl(scene.tile_url);
  const hasImage = Boolean(preview || tile);

  if (storedStatus === 'generated' || storedStatus === 'generated_inline_preview') {
    return hasImage ? 'generated' : 'metadata_only';
  }

  if (hasImage) {
    return scene.ndvi_mean != null ? 'generated' : 'metadata_only';
  }

  return 'metadata_only';
}

function pickUrl(...values) {
  for (const value of values) {
    const text = value == null ? '' : String(value).trim();
    if (text.length > 0) return text;
  }
  return null;
}

export function bboxFromStac(featureBbox) {
  if (!Array.isArray(featureBbox) || featureBbox.length < 4) return null;
  const [west, south, east, north] = featureBbox.map(Number);
  if ([west, south, east, north].some((n) => !Number.isFinite(n))) return null;
  return { west, south, east, north };
}

export function formatSceneForApi(scene) {
  const preview = pickUrl(scene.preview_url, scene.thumbnail_url);
  const tile = pickUrl(scene.tile_url);
  const status = resolveSceneStatus({ ...scene, preview_url: preview });

  return {
    id: scene.id,
    scene_id: scene.scene_id || scene.id,
    image_date: scene.image_date,
    date: scene.image_date,
    provider: scene.provider || PROVIDER_LABEL,
    source: scene.source || 'sentinel_2_l2a',
    cloud_coverage: scene.cloud_coverage,
    cloudPercent: scene.cloud_coverage,
    ndvi_mean: scene.ndvi_mean,
    meanNdvi: scene.ndvi_mean,
    ndvi_min: scene.ndvi_min,
    ndvi_max: scene.ndvi_max,
    resolution_m: scene.resolution_m ?? 10,
    resolutionMeters: scene.resolution_m ?? 10,
    preview_url: preview,
    previewUrl: preview,
    thumbnail_url: scene.thumbnail_url || preview,
    thumbnailUrl: scene.thumbnail_url || preview,
    tile_url: tile,
    tileUrl: tile,
    raster_url: scene.raster_url ?? null,
    bounds: scene.bounds ?? null,
    bbox: scene.bounds ?? null,
    layer_id: scene.layer_id ?? null,
    layerId: scene.layer_id ?? null,
    status,
    available: status !== 'failed',
  };
}

export function logScenesSummary({ plotId, farmId, scenes }) {
  console.log(
    `ℹ️ [NDVI][Scenes] plotId=${plotId} farmId=${farmId} total=${scenes.length} (deduped)`,
  );
  for (const scene of scenes) {
    console.log(
      `ℹ️ [NDVI][Scene] plotId=${plotId} farmId=${farmId} date=${scene.image_date} ` +
        `provider=${scene.provider || '-'} cloud=${scene.cloud_coverage ?? '-'} ` +
        `ndviMean=${scene.ndvi_mean ?? '-'} preview=${scene.preview_url ? 'yes' : 'no'} ` +
        `thumb=${scene.thumbnail_url ? 'yes' : 'no'} tile=${scene.tile_url ? 'yes' : 'no'} ` +
        `layerId=${scene.layer_id || '-'} status=${scene.status}`,
    );
  }
}
