/**
 * Modos disponíveis via raster persistido (Copernicus + internal grid).
 */
export const RASTER_VISUAL_MODES = Object.freeze([
  'ndvi_contrast',
  'ndvi_absolute',
  'ndvi_relative',
  'agronomic_classes',
  'ndre',
  'savi',
  'bsi_soil',
  'ndmi_water_stress',
]);

export function normalizeVisualModeKey(value) {
  const mode = String(value || 'ndvi_contrast').trim().replace(/[-\s]+/g, '_').toLowerCase();
  switch (mode) {
    case 'ndvi':
    case 'contrast':
      return 'ndvi_contrast';
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
      return mode || 'ndvi_contrast';
  }
}

export function canRenderFromPersistedRaster(visualMode, raster) {
  const mode = normalizeVisualModeKey(visualMode);
  if (!RASTER_VISUAL_MODES.includes(mode)) return false;
  if (!raster?.bands?.ndvi?.length) return false;
  if (mode === 'ndre' && !raster.bands?.ndre?.length) return false;
  if (mode === 'savi' && !raster.bands?.savi?.length) return false;
  if (mode === 'bsi_soil' && !raster.bands?.bsi?.length) return false;
  if (mode === 'ndmi_water_stress' && !raster.bands?.ndmi?.length) return false;
  return true;
}

export function missingBandsForVisualMode(visualMode, raster) {
  const mode = normalizeVisualModeKey(visualMode);
  const bands = raster?.bands || {};
  const missing = [];
  if (!bands.ndvi?.length) missing.push('B04/B08');
  if (mode === 'ndre' && !bands.ndre?.length) missing.push('B05/B8A');
  if (mode === 'savi' && !bands.savi?.length) missing.push('B04/B08');
  if (mode === 'bsi_soil' && !bands.bsi?.length) missing.push('B04/B08/B11');
  if (mode === 'ndmi_water_stress' && !bands.ndmi?.length) missing.push('B08/B11');
  return missing;
}

export function assertVisualModeSupported({
  visualMode,
  raster = null,
  geeAvailable = false,
} = {}) {
  const mode = normalizeVisualModeKey(visualMode);
  if (mode === 'ndvi_contrast') return mode;
  // GEE só entra com opt-in explícito; por padrão Copernicus usa raster persistido.
  if (geeAvailable && RASTER_VISUAL_MODES.includes(mode)) return mode;
  // Sem GEE: só liberamos modos avançados se houver raster persistido (Copernicus).
  if (canRenderFromPersistedRaster(mode, raster)) return mode;

  const missing = missingBandsForVisualMode(mode, raster);
  const reason = missing.length
    ? `A cena não possui as bandas necessárias para "${mode}": ${missing.join(', ')}.`
    : `Modo visual "${mode}" não é suportado para Sentinel/Copernicus.`;
  const err = new Error(reason);
  err.code = 'unsupported_visual_mode';
  err.status = 422;
  err.details = { visualMode: mode, missingBands: missing };
  throw err;
}
