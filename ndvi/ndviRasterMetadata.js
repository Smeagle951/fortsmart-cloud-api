export const NDVI_RASTER_BANDS = Object.freeze([
  'ndvi',
  'ndre',
  'savi',
  'ndmi',
  'bsi',
  'valid_mask',
]);

export function buildNdviRasterMetadata({
  grid,
  bounds,
  rasterUrl = null,
  resolutionM = 10,
} = {}) {
  const available = Boolean(grid?.values?.length && grid?.width && grid?.height);
  return {
    raster_available: available,
    raster_url: rasterUrl,
    raster_format: available ? 'internal_grid' : null,
    raster_bands: available ? [...NDVI_RASTER_BANDS] : [],
    raster_bounds: bounds ?? null,
    raster_resolution_m: resolutionM,
  };
}
