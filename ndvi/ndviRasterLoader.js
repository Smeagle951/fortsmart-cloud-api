/**
 * Carregamento do raster científico persistido.
 */
import { loadInternalGrid as loadFromStore } from './ndviRasterStore.js';

export async function loadInternalGrid({ plotId, sceneId, schemaVersion = 1 }) {
  return loadFromStore({ plotId, sceneId, schemaVersion });
}

export function internalGridToValuesGrid(raster) {
  if (!raster?.bands?.ndvi) return null;
  const { ndvi, valid_mask } = raster.bands;
  const values = Array.from(ndvi, (v, i) =>
    valid_mask[i] && Number.isFinite(v) ? v : null,
  );
  return {
    values,
    width: raster.width,
    height: raster.height,
  };
}

export function selectBandForVisualMode(raster, visualMode) {
  const mode = String(visualMode || 'ndvi_contrast').toLowerCase();
  const bands = raster?.bands || {};
  switch (mode) {
    case 'ndre':
      return bands.ndre;
    case 'savi':
      return bands.savi;
    case 'ndmi_water_stress':
      return bands.ndmi;
    case 'bsi_soil':
      return bands.bsi;
    case 'ndvi_absolute':
    case 'ndvi_relative':
    case 'ndvi_contrast':
    case 'agronomic_classes':
    default:
      return bands.ndvi;
  }
}
