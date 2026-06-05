import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PNG } from 'pngjs';

import {
  serializeInternalGridDocument,
  deserializeInternalGridBuffer,
  gridDocumentFromStatsGrid,
  RASTER_SCHEMA_VERSION,
} from './ndviRasterSerializer.js';
import { generatePreviewFromRaster } from './ndviPreviewFromRaster.js';
import {
  scientificRasterCacheKey,
  visualPreviewCacheKey,
  shouldInvalidatePreview,
  shouldInvalidateRaster,
} from './ndviRasterCache.js';
import { buildNdviTemporalAnalytics } from './ndviTemporalAnalyticsEngine.js';

function syntheticGrid(w = 8, h = 8) {
  const cellCount = w * h;
  const ndvi = new Float32Array(cellCount);
  const ndre = new Float32Array(cellCount);
  const savi = new Float32Array(cellCount);
  const ndmi = new Float32Array(cellCount);
  const bsi = new Float32Array(cellCount);
  const valid_mask = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i += 1) {
    ndvi[i] = 0.3 + (i / cellCount) * 0.5;
    ndre[i] = ndvi[i] * 0.8;
    savi[i] = ndvi[i] * 0.9;
    ndmi[i] = 0.1 + i * 0.01;
    bsi[i] = 0.05;
    valid_mask[i] = 1;
  }
  return {
    schema_version: RASTER_SCHEMA_VERSION,
    created_at: '2026-05-01T00:00:00.000Z',
    plot_id: 'plot-1',
    scene_id: 'scene-1',
    width: w,
    height: h,
    bounds: { west: -54.5, south: -15.4, east: -54.4, north: -15.3 },
    crs: 'EPSG:4326',
    nodata: -9999,
    bands: { ndvi, ndre, savi, ndmi, bsi, valid_mask },
    metadata: {},
  };
}

test('internal_grid_v1 serializa e desserializa com checksum estável', () => {
  const doc = syntheticGrid();
  const a = serializeInternalGridDocument(doc);
  const b = serializeInternalGridDocument(doc);
  assert.equal(a.checksum, b.checksum);
  const loaded = deserializeInternalGridBuffer(a.buffer);
  assert.equal(loaded.schema_version, RASTER_SCHEMA_VERSION);
  assert.equal(loaded.width, 8);
  assert.equal(loaded.height, 8);
  assert.equal(loaded.bands.ndvi[0], doc.bands.ndvi[0]);
  assert.equal(loaded.bands.valid_mask[7], 1);
});

test('gridDocumentFromStatsGrid preserva bandas válidas', () => {
  const values = [0.2, 0.5, 0.8, 0.9, 0.4, 0.6, 0.7, 0.55, 0.45, 0.5, 0.6, 0.7, 0.8, 0.75, 0.72, 0.68];
  const doc = gridDocumentFromStatsGrid({
    plotId: 'p1',
    sceneId: 's1',
    bounds: { west: 1, south: 2, east: 3, north: 4 },
    statsGrid: { values, width: 4, height: 4 },
  });
  assert.ok(doc);
  assert.equal(doc.bands.ndvi.length, 16);
  assert.equal(doc.bands.valid_mask.filter((v) => v === 1).length, 16);
});

test('generatePreviewFromRaster produz PNG sem Sentinel', () => {
  const raster = deserializeInternalGridBuffer(
    serializeInternalGridDocument(syntheticGrid()).buffer,
  );
  const out = generatePreviewFromRaster({ raster, visualMode: 'ndvi_contrast' });
  assert.ok(out.buffer?.length > 100);
  assert.equal(out.rasterReuse, true);
  assert.ok(out.contrast?.p5 != null || out.contrast?.pLow != null);
});

test('generatePreviewFromRaster evita vermelho falso em cena homogênea alta', () => {
  const raster = syntheticGrid(8, 8);
  for (let i = 0; i < raster.bands.ndvi.length; i += 1) {
    raster.bands.ndvi[i] = 0.86 + (i / (raster.bands.ndvi.length - 1)) * 0.01;
  }
  const loaded = deserializeInternalGridBuffer(
    serializeInternalGridDocument(raster).buffer,
  );
  const out = generatePreviewFromRaster({ raster: loaded, visualMode: 'ndvi_contrast' });
  assert.equal(out.contrast.lowContrastScene, true);

  const png = PNG.sync.read(out.buffer);
  let redPixels = 0;
  let visiblePixels = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3] < 40) continue;
    visiblePixels += 1;
    if (png.data[i] > png.data[i + 1] * 1.2 && png.data[i] > png.data[i + 2] * 1.2) {
      redPixels += 1;
    }
  }
  assert.ok(visiblePixels > 0);
  assert.ok(redPixels / visiblePixels < 0.05);
});

test('cache científico e visual têm chaves distintas', () => {
  const sci = scientificRasterCacheKey({ plotId: 'p', sceneId: 's' });
  const vis = visualPreviewCacheKey({
    plotId: 'p',
    sceneId: 's',
    visualMode: 'ndvi_contrast',
  });
  assert.notEqual(sci, vis);
  assert.equal(shouldInvalidatePreview({ previousRenderer: 'v1', nextRenderer: 'v2' }), true);
  assert.equal(shouldInvalidateRaster({ sentinelReprocessed: true }), true);
  assert.equal(
    shouldInvalidateRaster({ sentinelReprocessed: false, schemaChanged: false }),
    false,
  );
});

test('temporal analytics detecta degradação e recuperação', () => {
  const degrading = buildNdviTemporalAnalytics([
    { image_date: '2026-04-01', ndvi_mean: 0.82, spatial_metrics: { percentBelowP25: 12 } },
    { image_date: '2026-05-20', ndvi_mean: 0.72, spatial_metrics: { percentBelowP25: 28 } },
  ]);
  assert.equal(degrading.trend, 'worsening');
  assert.ok(degrading.degradingZones);

  const recovering = buildNdviTemporalAnalytics([
    { image_date: '2026-04-01', ndvi_mean: 0.7, spatial_metrics: { percentBelowP25: 30 } },
    { image_date: '2026-05-20', ndvi_mean: 0.78, spatial_metrics: { percentBelowP25: 14 } },
  ]);
  assert.equal(recovering.trend, 'recovering');
  assert.equal(recovering.recoveringZones, true);
});

test('store/load local persiste raster real', async () => {
  const { storeInternalGrid, loadInternalGrid } = await import('./ndviRasterStore.js');
  const doc = syntheticGrid();
  const stored = await storeInternalGrid({
    plotId: 'plot-1',
    sceneId: 'scene-local',
    document: doc,
  });
  assert.equal(stored.provider, 'local');
  const loaded = await loadInternalGrid({ plotId: 'plot-1', sceneId: 'scene-local' });
  assert.ok(loaded?.bands?.ndvi?.length === 64);
});
