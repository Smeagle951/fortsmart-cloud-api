import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import SentinelProcessClient from './sentinelProcess.client.js';
import {
  serializeInternalGridDocument,
  deserializeInternalGridBuffer,
  RASTER_SCHEMA_VERSION,
} from './ndviRasterSerializer.js';
import { storeInternalGrid } from './ndviRasterStore.js';

function syntheticRaster(w = 8, h = 8) {
  const polygon = {
    coordinates: [[[-54.5, -15.4], [-54.4, -15.4],
      [-54.4, -15.3], [-54.5, -15.3], [-54.5, -15.4]]],
  };
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
    metadata: {
      polygonHash: createHash('sha256')
        .update(JSON.stringify(polygon.coordinates)).digest('hex').slice(0, 12),
    },
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
    polygon: {
      type: 'Polygon',
      coordinates: [[
        [-54.5, -15.4], [-54.4, -15.4], [-54.4, -15.3],
        [-54.5, -15.3], [-54.5, -15.4],
      ]],
    },
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

test('force regera a camada mas reutiliza o raster científico persistido', async () => {
  const client = new SentinelProcessClient({ authClient: null, enableDevMock: true });
  const raster = deserializeInternalGridBuffer(
    serializeInternalGridDocument(syntheticRaster()).buffer,
  );
  await storeInternalGrid({
    plotId: 'plot-1',
    sceneId: 'scene-1',
    document: raster,
  });
  const original = client.generateNdviLayer.bind(client);
  client.generateNdviLayer = async () => {
    throw new Error('generateNdviLayer should not be called when raster exists');
  };
  const polygon = {
    type: 'Polygon',
    coordinates: [[
      [-54.5, -15.4],
      [-54.4, -15.4],
      [-54.4, -15.3],
      [-54.5, -15.3],
      [-54.5, -15.4],
    ]],
  };

  const result = await client.generateLayerPackage({
    sceneId: 'scene-1',
    farmId: 'farm-1',
    plotId: 'plot-1',
    polygon,
    imageDate: '2026-06-05',
    modes: ['ndvi_contrast', 'ndmi_water_stress', 'ndre'],
    force: true,
  });

  client.generateNdviLayer = original;

  assert.deepEqual(Object.keys(result.layersByMode).sort(), [
    'ndmi_water_stress',
    'ndre',
    'ndvi_contrast',
  ]);
  assert.equal(result.statusesByMode.ndre.status, 'ready');
  assert.equal(result.statusesByMode.ndmi_water_stress.status, 'ready');
});

test('NDRE atualiza grade NDVI rápida sem bandas avançadas antes de renderizar', async () => {
  const client = new SentinelProcessClient({ authClient: null, enableDevMock: true });
  const cacheSuffix = `${process.pid}-${Date.now()}`;
  const plotId = `plot-upgrade-${cacheSuffix}`;
  const sceneId = `scene-upgrade-${cacheSuffix}`;
  const polygon = {
    type: 'Polygon',
    coordinates: [[
      [-54.5, -15.4], [-54.4, -15.4], [-54.4, -15.3],
      [-54.5, -15.3], [-54.5, -15.4],
    ]],
  };
  const ndviOnly = syntheticRaster();
  ndviOnly.plot_id = plotId;
  ndviOnly.scene_id = sceneId;
  ndviOnly.metadata.polygonHash = createHash('sha256')
    .update(JSON.stringify(polygon.coordinates)).digest('hex').slice(0, 12);
  // `internal_grid_v1` mantém o layout de todas as bandas; a prévia rápida
  // preenche as avançadas com nodata, que não pode ser confundido com dado.
  for (const band of ['ndre', 'savi', 'ndmi', 'bsi']) {
    ndviOnly.bands[band].fill(-9999);
  }
  await storeInternalGrid({ plotId, sceneId, document: ndviOnly });

  let generationMode = null;
  client.generateNdviLayer = async ({ visualMode }) => {
    generationMode = visualMode;
    const full = syntheticRaster();
    full.plot_id = plotId;
    full.scene_id = sceneId;
    full.metadata.polygonHash = ndviOnly.metadata.polygonHash;
    await storeInternalGrid({ plotId, sceneId, document: full });
    return { raster_available: true };
  };

  const result = await client.generateLayerPackage({
    sceneId,
    farmId: 'farm-1',
    plotId,
    polygon,
    imageDate: '2026-06-05',
    modes: ['ndre'],
  });

  assert.equal(generationMode, 'ndre');
  assert.equal(result.statusesByMode.ndre.status, 'ready');
  assert.ok(result.layersByMode.ndre?.preview_url);
});

test('pacotes concorrentes reutilizam a mesma geração do raster base', async () => {
  const client = new SentinelProcessClient({ authClient: null, enableDevMock: true });
  // Keep this test isolated from the persistent raster cache left by prior runs.
  const cacheSuffix = `${process.pid}-${Date.now()}`;
  const plotId = `plot-inflight-${cacheSuffix}`;
  const sceneId = `scene-inflight-${cacheSuffix}`;
  const polygon = {
    type: 'Polygon',
    coordinates: [[
      [-54.5, -15.4], [-54.4, -15.4], [-54.4, -15.3],
      [-54.5, -15.3], [-54.5, -15.4],
    ]],
  };
  let baseCalls = 0;
  client.generateNdviLayer = async () => {
    baseCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    const document = syntheticRaster();
    document.plot_id = plotId;
    document.scene_id = sceneId;
    document.metadata.polygonHash = createHash('sha256')
      .update(JSON.stringify(polygon.coordinates)).digest('hex').slice(0, 12);
    await storeInternalGrid({ plotId, sceneId, document });
    return { raster_available: true };
  };

  const request = (mode) => client.generateLayerPackage({
    sceneId,
    farmId: 'farm-1',
    plotId,
    polygon,
    imageDate: '2026-06-05',
    modes: [mode],
    force: true,
  });
  const [absolute, contrastResult] = await Promise.all([
    request('ndvi_absolute'),
    request('ndvi_contrast'),
  ]);

  assert.equal(baseCalls, 1);
  assert.ok(absolute.layersByMode.ndvi_absolute);
  assert.ok(contrastResult.layersByMode.ndvi_contrast);
});
