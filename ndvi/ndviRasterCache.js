/**
 * Chaves de cache científico (raster) vs visual (preview).
 */
import { RENDERER_VERSION } from './agronomicContrastRendererV2.js';
import { RASTER_SCHEMA_NUM } from './ndviRasterSerializer.js';

export const PREVIEW_STYLE_VERSION = 'preview_v2';

export function scientificRasterCacheKey({ plotId, sceneId, rasterSchemaVersion = RASTER_SCHEMA_NUM }) {
  return `ndvi:raster:${plotId}:${sceneId}:v${rasterSchemaVersion}`;
}

export function visualPreviewCacheKey({
  plotId,
  sceneId,
  visualMode,
  rendererVersion = RENDERER_VERSION,
  previewStyleVersion = PREVIEW_STYLE_VERSION,
}) {
  return `ndvi:preview:${plotId}:${sceneId}:${visualMode}:${rendererVersion}:${previewStyleVersion}`;
}

export function shouldInvalidatePreview({ previousRenderer, nextRenderer, styleVersionChanged }) {
  if (previousRenderer && nextRenderer && previousRenderer !== nextRenderer) return true;
  if (styleVersionChanged) return true;
  return false;
}

export function shouldInvalidateRaster({
  sourceChanged,
  resolutionChanged,
  schemaChanged,
  sentinelReprocessed,
}) {
  return Boolean(sourceChanged || resolutionChanged || schemaChanged || sentinelReprocessed);
}
