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
  const mode = String(value || 'ndvi_contrast').trim().toLowerCase();
  return mode || 'ndvi_contrast';
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

export function assertVisualModeSupported({
  visualMode,
  raster = null,
  geeAvailable = false,
} = {}) {
  const mode = normalizeVisualModeKey(visualMode);
  if (mode === 'ndvi_contrast') return mode;
  // GEE-primary: com GEE disponível, qualquer modo é renderizável server-side.
  if (geeAvailable && RASTER_VISUAL_MODES.includes(mode)) return mode;
  // Sem GEE: só liberamos modos avançados se houver raster persistido (Copernicus).
  if (canRenderFromPersistedRaster(mode, raster)) return mode;

  const err = new Error(
    `Modo "${mode}" exige Google Earth Engine ou raster persistido (gere NDVI Contraste primeiro).`,
  );
  err.code = 'unsupported_visual_mode';
  err.status = 422;
  throw err;
}
