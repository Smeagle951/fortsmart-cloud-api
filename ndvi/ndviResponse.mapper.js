function toIsoDate(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length >= 10) return text.slice(0, 10);
  return text;
}

function mapScene(featureOrRow) {
  if (!featureOrRow) return null;

  if (featureOrRow.scene_id || featureOrRow.id) {
    const id = String(featureOrRow.scene_id || featureOrRow.id);
    return {
      scene_id: id,
      id,
      image_date: toIsoDate(featureOrRow.image_date || featureOrRow.imageDate),
      source: featureOrRow.source || 'sentinel_2_l2a',
      cloud_coverage: featureOrRow.cloud_coverage ?? featureOrRow.cloudCoverage ?? null,
      resolution_m: featureOrRow.resolution_m ?? featureOrRow.resolutionM ?? 10,
      preview_url: featureOrRow.preview_url ?? featureOrRow.previewUrl ?? null,
      ndvi_mean: featureOrRow.ndvi_mean ?? featureOrRow.ndviMean ?? null,
      ndvi_min: featureOrRow.ndvi_min ?? featureOrRow.ndviMin ?? null,
      ndvi_max: featureOrRow.ndvi_max ?? featureOrRow.ndviMax ?? null,
      status: featureOrRow.status || 'available',
    };
  }

  const props = featureOrRow.properties || {};
  const id = String(featureOrRow.id || props.id || props['s2:id'] || '');
  if (!id) return null;

  const datetime = props.datetime || props.startDate || props['s2:datatake_id'];
  const cloud = props['eo:cloud_cover'] ?? props.cloudCover ?? props.cloud_coverage;

  return {
    scene_id: id,
    id,
    image_date: toIsoDate(datetime),
    source: 'sentinel_2_l2a',
    cloud_coverage: cloud != null ? Number(cloud) : null,
    resolution_m: 10,
    preview_url: null,
    ndvi_mean: null,
    ndvi_min: null,
    ndvi_max: null,
    status: 'available',
  };
}

function mapLayer(row) {
  if (!row) return null;
  const layerId = String(row.layer_id || row.id || '');
  if (!layerId) return null;

  return {
    layer_id: layerId,
    id: layerId,
    farm_id: row.farm_id,
    plot_id: row.plot_id,
    campaign_id: row.campaign_id,
    image_date: toIsoDate(row.image_date),
    source: row.source || 'sentinel_2_l2a',
    cloud_coverage: row.cloud_coverage,
    resolution_m: row.resolution_m ?? 10,
    ndvi_mean: row.ndvi_mean,
    ndvi_min: row.ndvi_min,
    ndvi_max: row.ndvi_max,
    very_low_percent: row.very_low_percent,
    low_percent: row.low_percent,
    medium_percent: row.medium_percent,
    high_percent: row.high_percent,
    preview_url: row.preview_url ?? null,
    tile_url: row.tile_url ?? null,
    raster_url: row.raster_url ?? null,
    is_active: Boolean(row.is_active),
    attached_at: row.attached_at || null,
    status: row.status || (row.preview_url ? 'generated' : 'metadata_only'),
  };
}

function mapScenes(list) {
  if (!Array.isArray(list)) return [];
  return list.map(mapScene).filter(Boolean);
}

module.exports = {
  mapScene,
  mapLayer,
  mapScenes,
  toIsoDate,
};
