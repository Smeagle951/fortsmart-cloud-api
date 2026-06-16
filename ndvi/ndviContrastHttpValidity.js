/**
 * Contrato HTTP para visual_mode=ndvi_contrast (generate).
 */

export function contrastIsComplete(contrast) {
  return (
    contrast != null &&
    isFiniteNumber(contrast.p5) &&
    isFiniteNumber(contrast.p50) &&
    isFiniteNumber(contrast.p95)
  );
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

export function parseAgronomicStats(row) {
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

export function resolveRequestedVisualMode(value) {
  if (value && typeof value === 'object') {
    const fromBody =
      value.visual_mode ?? value.visualMode ?? value.colormap_mode ?? value.colormapMode;
    if (fromBody != null) return normalizeVisualModeAlias(fromBody);
  }
  return normalizeVisualModeAlias(value);
}

function normalizeVisualModeAlias(value) {
  const mode = String(value || 'ndvi_contrast')
    .trim()
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
  if (!mode) return 'ndvi_contrast';
  switch (mode) {
    case 'ndvi':
    case 'contrast':
      return 'ndvi_contrast';
    case 'absolute':
      return 'ndvi_absolute';
    case 'relative':
      return 'ndvi_relative';
    case 'vigor':
    case 'auto':
      return 'agronomic_classes';
    case 'ndmi':
    case 'moisture':
    case 'umidade':
      return 'ndmi_water_stress';
    case 'rededge':
    case 'red_edge':
      return 'ndre';
    case 'soilplant':
    case 'soil_plant':
    case 'soil_palhada':
    case 'solo_palhada':
    case 'solo_planta':
      return 'bsi_soil';
    default:
      return mode;
  }
}

function readLayerSchemaVersion(layer) {
  return (
    layer?.schema_version ??
    layer?.schemaVersion ??
    layer?.ndvi_schema_version ??
    layer?.ndviSchemaVersion ??
    parseAgronomicStats(layer)?.schema_version ??
    parseAgronomicStats(layer)?.ndvi_schema_version ??
    null
  );
}

function isNdviV3Schema(layer) {
  const schema = readLayerSchemaVersion(layer);
  if (schema === 'ndvi_v3') return true;
  return Number(schema) >= 3;
}

function isLegacyLayer(layer) {
  return (
    layer?.isLegacy === true ||
    layer?.is_legacy === true ||
    layer?.isLegacySchema === true ||
    layer?.is_legacy_schema === true ||
    layer?.legacy === true
  );
}

export function readLayerBounds(layer) {
  const bounds = layer?.bounds ?? layer?.preview_bounds;
  const bbox = layer?.bbox;
  if (bbox != null) {
    if (Array.isArray(bbox) && bbox.length >= 4) {
      return normalizeBounds({
        west: bbox[0],
        south: bbox[1],
        east: bbox[2],
        north: bbox[3],
      });
    }
    if (typeof bbox === 'object') return normalizeBounds(bbox);
  }
  if (bounds == null) return false;
  if (Array.isArray(bounds) && bounds.length >= 4) {
    return normalizeBounds({
      west: bounds[0],
      south: bounds[1],
      east: bounds[2],
      north: bounds[3],
    });
  }
  if (typeof bounds === 'object') {
    return normalizeBounds(bounds);
  }
  return null;
}

function normalizeBounds(raw) {
  const west = Number(raw?.west ?? raw?.left ?? raw?.bounds_west ?? raw?.boundsWest);
  const south = Number(raw?.south ?? raw?.bottom ?? raw?.bounds_south ?? raw?.boundsSouth);
  const east = Number(raw?.east ?? raw?.right ?? raw?.bounds_east ?? raw?.boundsEast);
  const north = Number(raw?.north ?? raw?.top ?? raw?.bounds_north ?? raw?.boundsNorth);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  return { west, south, east, north };
}

function boundsCloseToRequest(layerBounds, requestBounds) {
  if (!requestBounds) return true;
  const layer = normalizeBounds(layerBounds);
  const request = normalizeBounds(requestBounds);
  if (!layer || !request) return false;
  const requestWidth = request.east - request.west;
  const requestHeight = request.north - request.south;
  const layerWidth = layer.east - layer.west;
  const layerHeight = layer.north - layer.south;
  const toleranceLon = Math.max(requestWidth * 0.25, 0.00001);
  const toleranceLat = Math.max(requestHeight * 0.25, 0.00001);
  if (layerWidth > requestWidth + toleranceLon) return false;
  if (layerHeight > requestHeight + toleranceLat) return false;
  if (layer.west < request.west - toleranceLon) return false;
  if (layer.east > request.east + toleranceLon) return false;
  if (layer.south < request.south - toleranceLat) return false;
  if (layer.north > request.north + toleranceLat) return false;
  return true;
}

export function readLayerContrast(layer) {
  if (!layer) return null;
  return layer.contrast ?? parseAgronomicStats(layer)?.contrast ?? null;
}

export function layerMeetsContrastContract(
  layer,
  requestedVisualMode = 'ndvi_contrast',
  { requestBounds = null } = {},
) {
  if (!layer) return false;
  const mode = layer.visual_mode ?? layer.visualMode;
  if (mode !== requestedVisualMode) return false;

  const preview =
    (layer.preview_url && String(layer.preview_url).trim()) ||
    (layer.previewUrl && String(layer.previewUrl).trim());
  if (!preview) return false;

  if (requestedVisualMode !== 'ndvi_contrast') {
    const bounds = readLayerBounds(layer);
    if (!bounds) return false;
    return boundsCloseToRequest(bounds, requestBounds);
  }

  if (mode !== 'ndvi_contrast') return false;
  if (!isNdviV3Schema(layer)) return false;
  if (isLegacyLayer(layer)) return false;
  if (!contrastIsComplete(readLayerContrast(layer))) return false;
  const bounds = readLayerBounds(layer);
  if (!bounds) return false;
  return boundsCloseToRequest(bounds, requestBounds);
}

export function validateNdviContrastHttpResponse(
  layer,
  requestedVisualMode = 'ndvi_contrast',
  { requestBounds = null } = {},
) {
  if (requestedVisualMode !== 'ndvi_contrast') {
    const resultVisualMode = layer?.visual_mode ?? layer?.visualMode ?? null;
    const bounds = readLayerBounds(layer);
    const hasPreview = !!(
      (layer?.preview_url && String(layer.preview_url).trim()) ||
      (layer?.previewUrl && String(layer.previewUrl).trim())
    );
    const ok =
      resultVisualMode === requestedVisualMode &&
      hasPreview &&
      !!bounds &&
      boundsCloseToRequest(bounds, requestBounds);
    return {
      ok,
      statusToReturn: ok ? 201 : 422,
      resultVisualMode,
      contrast: readLayerContrast(layer),
      hasContrast: contrastIsComplete(readLayerContrast(layer)),
      hasPreview,
      hasBounds: !!bounds,
      bounds,
      boundsMatchRequest: boundsCloseToRequest(bounds, requestBounds),
    };
  }

  const resultVisualMode = layer?.visual_mode ?? layer?.visualMode ?? null;
  const contrast = readLayerContrast(layer);
  const hasContrast = contrastIsComplete(contrast);
  const bounds = readLayerBounds(layer);
  const schemaVersion = readLayerSchemaVersion(layer);
  const legacy = isLegacyLayer(layer);
  const schemaOk = isNdviV3Schema(layer);
  const hasPreview = !!(
    (layer?.preview_url && String(layer.preview_url).trim()) ||
    (layer?.previewUrl && String(layer.previewUrl).trim())
  );
  const boundsMatchRequest = boundsCloseToRequest(bounds, requestBounds);
  const ok =
    resultVisualMode === 'ndvi_contrast' &&
    schemaOk &&
    !legacy &&
    hasContrast &&
    hasPreview &&
    !!bounds &&
    boundsMatchRequest;

  return {
    ok,
    statusToReturn: ok ? 201 : 422,
    resultVisualMode,
    schemaVersion,
    schemaOk,
    legacy,
    contrast,
    hasContrast,
    hasPreview,
    hasBounds: !!bounds,
    bounds,
    boundsMatchRequest,
  };
}
