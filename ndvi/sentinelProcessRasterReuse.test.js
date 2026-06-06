import test from 'node:test';
import assert from 'node:assert/strict';

import SentinelProcessClient from './sentinelProcess.client.js';
import {
  serializeInternalGridDocument,
  deserializeInternalGridBuffer,
  RASTER_SCHEMA_VERSION,
} from './ndviRasterSerializer.js';

function syntheticRaster(w = 8, h = 8) {
  const cellCount = w * h;
  const ndvi = new Float32Array(cellCount);
  const ndre = new Float32Array(cellCount);
  const savi = new Float32Array(cellCount);
  const ndmi = new Float32Array(cellCount);
  const bsi = new Float32Array(cellCount);
  const valid_mask = new Uint8Array(cellCount);
  for (let i = 0; i < cellCount; i += 1) {
    ndvi[i] = 0.55 + (i / (cellCount - 1)) * 0.25;
    ndre[i] = 0.35 + (i / (cellCount - 1)) * 0.1;
    savi[i] = ndvi[i] * 0.9;
    ndmi[i] = 0.15 + (i / (cellCount - 1)) * 0.12;
    bsi[i] = 0.05;
    valid_mask[i] = 1;
  }
  return {
    schema_version: RASTER_SCHEMA_VERSION,
    plot_id: 'plot-1',
    scene_id: 'scene-1',
    width: w,
    height: h,
    bounds: { west: -54.5, south: -15.4, east: -54.4, north: -15.3 },
    crs: 'EPSG:4326',
    nodata: -9999,
    bands: { ndvi, ndre, savi, ndmi, bsi, valid_mask },
    metadata: {},
    raster_storage_key: 'ndvi/internal-grid/plot-1/scene-1/grid_v1.bin',
    raster_storage_provider: 'local',
  };
}

test('raster reuse retorna preview e stats completas', async () => {
  const client = new SentinelProcessClient({ authClient: null, enableDevMock: true });
  const raster = deserializeInternalGridBuffer(
    serializeInternalGridDocument(syntheticRaster()).buffer,
  );
  raster.raster_storage_key = 'ndvi/internal-grid/plot-1/scene-1/grid_v1.bin';
  raster.raster_storage_provider = 'local';

  const layer = await client._layerFromPersistedRaster({
    raster,
    sceneId: 'scene-1',
    farmId: 'farm-1',
    plotId: 'plot-1',
    imageDate: '2026-06-05',
    polygon: {
      type: 'Polygon',
      coordinates: [[
        [-54.5, -15.4],
        [-54.4, -15.4],
        [-54.4, -15.3],
        [-54.5, -15.3],
        [-54.5, -15.4],
      ]],
    },
    visualMode: 'ndvi_contrast',
  });

  assert.equal(layer.cacheHit, true);
  assert.equal(layer.rasterReuse, true);
  assert.equal(layer.raster_available, true);
  assert.equal(layer.stats.ndvi_mean > 0, true);
  assert.equal(layer.stats.ndvi_p5 != null, true);
  assert.equal(layer.stats.ndvi_p50 != null, true);
  assert.equal(layer.stats.ndvi_p95 != null, true);
  assert.equal(layer.stats.validPixelCount, 64);
  assert.equal(layer.diagnosis != null, true);
  assert.equal(layer.legend != null, true);
  assert.equal(layer.sourceContext.statsRecomputed, true);
});

test('raster reuse nao mistura metadata de visualModes diferentes', async () => {
  const client = new SentinelProcessClient({ authClient: null, enableDevMock: true });
  const raster = deserializeInternalGridBuffer(
    serializeInternalGridDocument(syntheticRaster()).buffer,
  );
  const base = {
    raster,
    sceneId: 'scene-1',
    farmId: 'farm-1',
    plotId: 'plot-1',
    imageDate: '2026-06-05',
    polygon: null,
  };
  const contrast = await client._layerFromPersistedRaster({
    ...base,
    visualMode: 'ndvi_contrast',
  });
  const moisture = await client._layerFromPersistedRaster({
    ...base,
    visualMode: 'ndmi_water_stress',
  });
  assert.equal(contrast.visual_mode, 'ndvi_contrast');
  assert.equal(moisture.visual_mode, 'ndmi_water_stress');
  assert.notEqual(contrast.cacheTag, moisture.cacheTag);
  assert.notEqual(contrast.legend.title, moisture.legend.title);
});
