import { resolveLayerStatus } from './ndviValidity.js';

function toIsoDate(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length >= 10) return text.slice(0, 10);
  return text;
}

function readStacAssets(feature) {
  const assets = feature?.assets || {};
  const thumbnail =
    assets.thumbnail?.href ||
    assets['thumbnail.jpg']?.href ||
    assets.rendered_preview?.href ||
    assets.visual?.href ||
    null;
  return { thumbnail };
}

function parseAgronomicStatsField(row) {
  const raw = row?.agronomic_stats ?? row?.agronomic_stats_json;
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function parseBounds(row, ag) {
  const parsed = parseAgronomicStatsField(row);
  const raw =
    row?.bounds ?? ag?.bounds ?? parsed?.bounds ?? row?.preview_bounds;
  if (raw == null) return null;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  if (Array.isArray(raw) && raw.length >= 4) {
    return {
      west: Number(raw[0]),
      south: Number(raw[1]),
      east: Number(raw[2]),
      north: Number(raw[3]),
    };
  }
  if (typeof raw === 'object') return raw;
  return null;
}

function pickAgronomic(row) {
  const parsed = parseAgronomicStatsField(row);
  const raw =
    parsed ??
    (row?.agronomic_stats && typeof row.agronomic_stats === 'object'
      ? row.agronomic_stats
      : row?.stats && typeof row.stats === 'object'
        ? row.stats
        : row);
  const classes = raw?.classes || row?.classes || {};
  const contrast = raw?.contrast ?? row?.contrast ?? null;
  return {
    schema_version:
      raw?.schema_version ?? raw?.schemaVersion ?? row?.schema_version ?? null,
    ndvi_schema_version:
      raw?.ndvi_schema_version ?? raw?.ndviSchemaVersion ?? row?.ndvi_schema_version ?? null,
    visual_mode: raw?.visual_mode ?? raw?.visualMode ?? row?.visual_mode ?? row?.visualMode ?? null,
    ndvi_p5: raw?.ndvi_p5 ?? raw?.ndviP5 ?? contrast?.p5 ?? null,
    ndvi_std: raw?.ndvi_std ?? raw?.ndviStd ?? null,
    ndvi_p10: raw?.ndvi_p10 ?? raw?.ndviP10 ?? contrast?.p10 ?? null,
    ndvi_p25: raw?.ndvi_p25 ?? raw?.ndviP25 ?? null,
    ndvi_p50: raw?.ndvi_p50 ?? raw?.ndviP50 ?? contrast?.p50 ?? null,
    ndvi_p75: raw?.ndvi_p75 ?? raw?.ndviP75 ?? contrast?.p75 ?? null,
    ndvi_p90: raw?.ndvi_p90 ?? raw?.ndviP90 ?? contrast?.p90 ?? null,
    ndvi_p95: raw?.ndvi_p95 ?? raw?.ndviP95 ?? contrast?.p95 ?? null,
    ndvi_p98: raw?.ndvi_p98 ?? raw?.ndviP98 ?? null,
    ndre_mean: raw?.ndre_mean ?? raw?.ndreMean ?? null,
    savi_mean: raw?.savi_mean ?? raw?.saviMean ?? null,
    bsi_mean: raw?.bsi_mean ?? raw?.bsiMean ?? null,
    ndmi_mean: raw?.ndmi_mean ?? raw?.ndmiMean ?? null,
    bare_soil_percent:
      raw?.bare_soil_percent ?? classes?.bareSoilPercent ?? null,
    straw_percent: raw?.straw_percent ?? classes?.strawPercent ?? null,
    low_vigor_percent: raw?.low_vigor_percent ?? classes?.lowVigorPercent ?? null,
    medium_vigor_percent:
      raw?.medium_vigor_percent ?? classes?.mediumVigorPercent ?? null,
    high_vigor_percent: raw?.high_vigor_percent ?? classes?.highVigorPercent ?? null,
    very_high_vigor_percent:
      raw?.very_high_vigor_percent ?? classes?.veryHighVigorPercent ?? null,
    stress_candidate_percent:
      raw?.stress_candidate_percent ?? classes?.stressCandidatePercent ?? null,
    water_percent: raw?.water_percent ?? classes?.waterPercent ?? null,
    contrast,
    spatial_metrics: raw?.spatial_metrics ?? row?.spatial_metrics ?? null,
    rendering: raw?.rendering ?? row?.rendering ?? null,
    temporal_intelligence:
      raw?.temporal_intelligence ?? row?.temporal_intelligence ?? null,
    available_visual_modes:
      raw?.available_visual_modes ?? row?.available_visual_modes ?? null,
    zones: raw?.zones ?? row?.zones ?? [],
    raster_url: raw?.raster_url ?? row?.raster_url ?? null,
    raster_available: raw?.raster_available ?? row?.raster_available ?? null,
    raster_format: raw?.raster_format ?? row?.raster_format ?? null,
    raster_bands: raw?.raster_bands ?? row?.raster_bands ?? null,
    raster_bounds: raw?.raster_bounds ?? row?.raster_bounds ?? null,
    raster_resolution_m:
      raw?.raster_resolution_m ?? row?.raster_resolution_m ?? null,
    raster_storage_key: raw?.raster_storage_key ?? row?.raster_storage_key ?? null,
    raster_storage_provider:
      raw?.raster_storage_provider ?? row?.raster_storage_provider ?? null,
    raster_schema_version:
      raw?.raster_schema_version ?? row?.raster_schema_version ?? null,
  };
}

function mapScene(featureOrRow) {
  if (!featureOrRow) return null;

  if (featureOrRow.scene_id || (featureOrRow.id && !featureOrRow.properties)) {
    const ag = pickAgronomic(featureOrRow);
    const id = String(featureOrRow.scene_id || featureOrRow.id);
    return {
      scene_id: id,
      id,
      image_date: toIsoDate(featureOrRow.image_date || featureOrRow.imageDate),
      source: featureOrRow.source || 'sentinel-2-l2a',
      provider: featureOrRow.provider || 'copernicus_dataspace',
      cloud_coverage: featureOrRow.cloud_coverage ?? featureOrRow.cloudCoverage ?? null,
      resolution_m: featureOrRow.resolution_m ?? featureOrRow.resolutionM ?? 10,
      preview_url: featureOrRow.preview_url ?? featureOrRow.previewUrl ?? null,
      thumbnail_url:
        featureOrRow.thumbnail_url ??
        featureOrRow.thumbnailUrl ??
        featureOrRow.preview_url ??
        null,
      tile_url: featureOrRow.tile_url ?? featureOrRow.tileUrl ?? null,
      raster_url: featureOrRow.raster_url ?? featureOrRow.rasterUrl ?? null,
      ndvi_mean: featureOrRow.ndvi_mean ?? featureOrRow.ndviMean ?? null,
      ndvi_min: featureOrRow.ndvi_min ?? featureOrRow.ndviMin ?? null,
      ndvi_max: featureOrRow.ndvi_max ?? featureOrRow.ndviMax ?? null,
      visual_mode: featureOrRow.visual_mode ?? featureOrRow.visualMode ?? null,
      ...ag,
      classes: featureOrRow.classes ?? {
        bareSoilPercent: ag.bare_soil_percent,
        strawPercent: ag.straw_percent,
        lowVigorPercent: ag.low_vigor_percent,
        mediumVigorPercent: ag.medium_vigor_percent,
        highVigorPercent: ag.high_vigor_percent,
        veryHighVigorPercent: ag.very_high_vigor_percent,
        stressCandidatePercent: ag.stress_candidate_percent,
      },
      layer_id: featureOrRow.layer_id ?? featureOrRow.layerId ?? null,
      layer_status: featureOrRow.layer_status ?? null,
      status: featureOrRow.status || 'metadata_only',
    };
  }

  const props = featureOrRow.properties || {};
  const id = String(featureOrRow.id || props.id || props['s2:id'] || '');
  if (!id) return null;

  const datetime =
    props.datetime ||
    props.start_datetime ||
    props.startDate ||
    props['s2:datatake_id'];
  const cloud = props['eo:cloud_cover'] ?? props.cloudCover ?? props.cloud_coverage;
  const { thumbnail } = readStacAssets(featureOrRow);
  const bounds = Array.isArray(featureOrRow.bbox)
    ? {
        west: featureOrRow.bbox[0],
        south: featureOrRow.bbox[1],
        east: featureOrRow.bbox[2],
        north: featureOrRow.bbox[3],
      }
    : null;

  return {
    scene_id: id,
    id,
    image_date: toIsoDate(datetime),
    source: 'sentinel-2-l2a',
    provider: 'copernicus_dataspace',
    cloud_coverage: cloud != null ? Number(cloud) : null,
    resolution_m: 10,
    preview_url: null,
    thumbnail_url: thumbnail,
    tile_url: null,
    ndvi_mean: null,
    ndvi_min: null,
    ndvi_max: null,
    bounds,
    layer_id: null,
    layer_status: null,
    status: 'metadata_only',
  };
}

function mapLayer(row) {
  if (!row) return null;
  const layerId = String(row.layer_id || row.id || '');
  if (!layerId) return null;

  const preview = row.preview_url ?? null;
  const status = resolveLayerStatus(row);
  const ag = pickAgronomic(row);
  const boundsObj = parseBounds(row, ag);
  const bbox = boundsObj
    ? [
        boundsObj.west ?? boundsObj.left,
        boundsObj.south ?? boundsObj.bottom,
        boundsObj.east ?? boundsObj.right,
        boundsObj.north ?? boundsObj.top,
      ]
    : null;
  const visualModeVal =
    row.visual_mode ?? row.visualMode ?? ag?.visual_mode ?? row.colormap_mode ?? null;
  const schemaVersion =
    row.schema_version ??
    row.schemaVersion ??
    ag.schema_version ??
    (Number(ag.ndvi_schema_version ?? row.ndvi_schema_version) >= 3 ? 'ndvi_v3' : null);
  const ndviSchemaVersion =
    row.ndvi_schema_version ??
    row.ndviSchemaVersion ??
    ag.ndvi_schema_version ??
    (schemaVersion === 'ndvi_v3' ? 3 : null);
  const isLegacySchema =
    row.is_legacy_schema === true ||
    row.isLegacySchema === true ||
    row.is_legacy === true ||
    row.isLegacy === true ||
    schemaVersion !== 'ndvi_v3' ||
    Number(ndviSchemaVersion ?? 0) < 3;
  const classes = row.classes ?? {
    bareSoilPercent: ag.bare_soil_percent,
    strawPercent: ag.straw_percent,
    lowVigorPercent: ag.low_vigor_percent,
    mediumVigorPercent: ag.medium_vigor_percent,
    highVigorPercent: ag.high_vigor_percent,
    veryHighVigorPercent: ag.very_high_vigor_percent,
    stressCandidatePercent: ag.stress_candidate_percent,
  };

  return {
    layer_id: layerId,
    id: layerId,
    scene_id: row.scene_id ?? null,
    farm_id: row.farm_id,
    plot_id: row.plot_id,
    campaign_id: row.campaign_id,
    image_date: toIsoDate(row.image_date),
    source: row.source || 'sentinel-2-l2a',
    provider: row.provider || 'copernicus_dataspace',
    provider_used: row.provider || 'copernicus_dataspace',
    processing_engine: row.processing_engine || 'copernicus_process_api',
    schema_version: schemaVersion,
    ndvi_schema_version: ndviSchemaVersion,
    is_legacy_schema: isLegacySchema,
    isLegacy: isLegacySchema,
    visual_mode: visualModeVal,
    visualMode: visualModeVal,
    available_visual_modes: ag.available_visual_modes ?? [
      'ndvi_absolute',
      'ndvi_contrast',
      'ndvi_relative',
      'agronomic_classes',
      'ndre',
      'savi',
      'bsi_soil',
      'ndmi_water_stress',
    ],
    cloud_coverage: row.cloud_coverage,
    resolution_m: row.resolution_m ?? 10,
    ndvi_mean: row.ndvi_mean,
    ndvi_min: row.ndvi_min,
    ndvi_max: row.ndvi_max,
    very_low_percent: row.very_low_percent,
    low_percent: row.low_percent,
    medium_percent: row.medium_percent,
    high_percent: row.high_percent,
    ...ag,
    classes,
    stats: {
      ndvi_mean: row.ndvi_mean,
      ndvi_min: row.ndvi_min,
      ndvi_max: row.ndvi_max,
      ndvi_std: ag.ndvi_std,
      ndvi_p10: ag.ndvi_p10,
      ndvi_p25: ag.ndvi_p25,
      ndvi_p50: ag.ndvi_p50,
      ndvi_p75: ag.ndvi_p75,
      ndvi_p90: ag.ndvi_p90,
      ndvi_p95: ag.ndvi_p95,
      ndvi_p98: ag.ndvi_p98,
      ndre_mean: ag.ndre_mean,
      savi_mean: ag.savi_mean,
      bsi_mean: ag.bsi_mean,
      ndmi_mean: ag.ndmi_mean,
      ...ag,
      classes,
    },
    contrast: ag.contrast ?? null,
    spatial_metrics: ag.spatial_metrics ?? null,
    zones: ag.zones ?? [],
    rendering: ag.rendering ?? null,
    temporal_intelligence: ag.temporal_intelligence ?? null,
    colormap_mode: row.colormap_mode ?? visualModeVal ?? null,
    bounds: boundsObj,
    preview_bounds: boundsObj,
    bbox,
    preview_url: preview,
    previewUrl: preview,
    tile_url: row.tile_url ?? null,
    raster_url: row.raster_url ?? ag.raster_url ?? null,
    rasterUrl: row.raster_url ?? ag.raster_url ?? null,
    raster_available: ag.raster_available ?? Boolean(row.raster_url),
    raster_format: ag.raster_format ?? null,
    raster_bands: ag.raster_bands ?? [],
    raster_bounds: ag.raster_bounds ?? boundsObj,
    raster_resolution_m: ag.raster_resolution_m ?? row.resolution_m ?? 10,
    raster_storage_key: ag.raster_storage_key ?? row.raster_storage_key ?? null,
    raster_storage_provider: ag.raster_storage_provider ?? row.raster_storage_provider ?? null,
    raster_schema_version: ag.raster_schema_version ?? row.raster_schema_version ?? null,
    is_active: Boolean(row.is_active),
    attached_at: row.attached_at || null,
    status,
  };
}

function mapScenes(list) {
  if (!Array.isArray(list)) return [];
  return list.map(mapScene).filter(Boolean);
}

export { mapScene, mapLayer, mapScenes, toIsoDate };
