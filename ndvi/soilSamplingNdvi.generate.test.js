import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import SoilSamplingNdviService from './soilSamplingNdvi.service.js';
import createSoilSamplingNdviRouter from './soilSamplingNdvi.routes.js';
import * as NdviResponseMapper from './ndviResponse.mapper.js';

const polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-54.48, -15.38],
      [-54.47, -15.38],
      [-54.47, -15.37],
      [-54.48, -15.37],
      [-54.48, -15.38],
    ],
  ],
};

const contrast = { p5: 0.35, p50: 0.62, p95: 0.81 };
const validRaster = {
  ok: true, layerStatus: 'FINAL_READY', validPixelCoveragePct: 100,
  width: 64, height: 64,
};
const bounds = { west: -54.48, south: -15.38, east: -54.47, north: -15.37 };

describe('NDVI provenance and final-layer gate', () => {
  const polygonHash = createHash('sha256')
    .update(JSON.stringify(polygon.coordinates)).digest('hex').slice(0, 12);
  const service = new SoilSamplingNdviService({
    repository: { ensureSchema: async () => {} },
    catalogClient: { polygonToBbox: () => [-54.48, -15.38, -54.47, -15.37] },
    processClient: {},
    authClient: { isConfigured: () => true },
  });
  const row = {
    provider: 'google_earth_engine',
    image_date: '2026-05-25',
    agronomic_stats: {
      layer_status: 'FINAL_READY', validPixelCoveragePct: 90,
      bounds,
      provenance: {
        sceneId: 'scene-abc', mode: 'ndvi_absolute',
        acquisitionDate: '2026-05-25',
        provider: 'google_earth_engine', resolutionM: 10,
        resolutionKind: 'final', algorithmVersion: 'layer_pipeline_v2_geometry_qa',
        polygonHash, bounds,
      },
    },
  };

  it('rejeita cache legado, polígono alterado e resolução divergente', () => {
    const query = { polygon, sceneId: 'scene-abc', mode: 'ndvi_absolute',
      resolutionKind: 'final' };
    assert.equal(service._cacheMatchesRequest(row, query), true);
    assert.equal(service._cacheMatchesRequest({ agronomic_stats: {} }, query), false);
    assert.equal(service._cacheMatchesRequest(row, {
      ...query, resolutionKind: 'preview',
    }), false);
    const changedPolygon = structuredClone(polygon);
    changedPolygon.coordinates[0][1][0] += 0.001;
    assert.equal(service._cacheMatchesRequest(row, {
      ...query, polygon: changedPolygon,
    }), false);
  });

  it('não vincula prévia à coleta', async () => {
    let activated = false;
    const gated = new SoilSamplingNdviService({
      repository: {
        ensureSchema: async () => {},
        getById: async () => ({
          id: 'layer-preview', farm_id: 'f1', plot_id: 'p1',
          agronomic_stats: { ...row.agronomic_stats, layer_status: 'PREVIEW_READY' },
        }),
        setActiveLayer: async () => { activated = true; },
      },
      catalogClient: {}, processClient: {},
      authClient: { isConfigured: () => true },
    });
    await assert.rejects(() => gated.attachLayer({
      campaignId: 'c1', farmId: 'f1', plotId: 'p1', layerId: 'layer-preview',
    }), (error) => error.code === 'layer_not_final_ready');
    assert.equal(activated, false);
  });

  it('force ignora o cache de renderização', async () => {
    let lookups = 0;
    let renders = 0;
    const forced = new SoilSamplingNdviService({
      repository: {
        ensureSchema: async () => {},
        findRecentCache: async () => { lookups += 1; return null; },
        upsertLayer: async (data) => ({ ...data, id: 'forced-layer' }),
      },
      catalogClient: { polygonToBbox: () => [-54.48, -15.38, -54.47, -15.37] },
      processClient: {
        generateLayerPackage: async () => {
          renders += 1;
          return { layersByMode: { ndvi_absolute: {
            preview_url: 'https://cdn.example/new.png', bounds,
            visual_mode: 'ndvi_absolute', ndvi_mean: 0.62,
            ndvi_min: 0.35, ndvi_max: 0.81,
            very_low_percent: 5, low_percent: 25,
            medium_percent: 40, high_percent: 30,
            raster_validation: validRaster,
          } }, statusesByMode: {} };
        },
      },
      authClient: { isConfigured: () => true },
    });
    const result = await forced.generateLayerPackage({
      farmId: 'f1', plotId: 'p1', sceneId: 'scene-abc',
      polygon, imageDate: '2026-05-25', modes: ['ndvi_absolute'],
      force: true, resolutionKind: 'final',
    });
    assert.equal(lookups, 0);
    assert.equal(renders, 1);
    assert.equal(result.layersByMode.ndvi_absolute.layerStatus, 'FINAL_READY');

    const preview = await forced.generateLayerPackage({
      farmId: 'f1', plotId: 'p1', sceneId: 'scene-abc',
      polygon, imageDate: '2026-05-25', modes: ['ndvi_absolute'],
      force: true, resolutionKind: 'fastPreview',
    });
    assert.equal(renders, 2);
    assert.equal(preview.layersByMode.ndvi_absolute.layerStatus, 'PREVIEW_READY');
  });
});

describe('SoilSamplingNdviService.generateLayer', () => {
  it('retorna 400 sem polígono', async () => {
    const service = new SoilSamplingNdviService({
      repository: { ensureSchema: async () => {} },
      catalogClient: {},
      processClient: {},
      authClient: { isConfigured: () => true },
    });

    await assert.rejects(
      () =>
        service.generateLayer({
          farmId: 'f1',
          plotId: 'p1',
          sceneId: 'scene-1',
          imageDate: '2026-05-25',
          polygon: null,
        }),
      (err) => err.code === 'plot_polygon_missing' && err.status === 400,
    );
  });

  it('retorna camada mapeada após process e persist', async () => {
    const savedRow = {
      id: 'layer-uuid-1',
      scene_id: 'scene-abc',
      farm_id: 'f1',
      plot_id: 'p1',
      campaign_id: '16',
      source: 'sentinel_2_l2a',
      image_date: '2026-05-25',
      status: 'generated',
      preview_url: 'https://cdn.example/ndvi.png',
      ndvi_mean: 0.62,
      ndvi_min: 0.35,
      ndvi_max: 0.81,
      very_low_percent: 5,
      low_percent: 25,
      medium_percent: 40,
      high_percent: 30,
      is_active: false,
    };

    const service = new SoilSamplingNdviService({
      repository: {
        ensureSchema: async () => {},
        findRecentCache: async () => null,
        upsertLayer: async (data) => ({ ...savedRow, ...data, id: savedRow.id }),
      },
      catalogClient: { polygonToBbox: () => [-54.48, -15.38, -54.47, -15.37] },
      processClient: {
        generateNdviLayer: async () => ({
          preview_url: 'https://cdn.example/ndvi.png',
          ndvi_mean: 0.62,
          ndvi_min: 0.35,
          ndvi_max: 0.81,
          very_low_percent: 5,
          low_percent: 25,
          medium_percent: 40,
          high_percent: 30,
          contrast,
          visual_mode: 'ndvi_contrast',
          raster_validation: validRaster,
          bounds,
          status: 'generated',
        }),
      },
      authClient: { isConfigured: () => true },
    });

    const layer = await service.generateLayer({
      farmId: 'f1',
      plotId: 'p1',
      campaignId: '16',
      sceneId: 'scene-abc',
      polygon,
      imageDate: '2026-05-25',
    });

    assert.equal(layer.id, 'layer-uuid-1');
    assert.equal(layer.status, 'ready');
    assert.ok(NdviResponseMapper.mapLayer(savedRow));
  });

  it('tenta cena alternativa quando a cena selecionada falha no provedor', async () => {
    const calls = [];
    const service = new SoilSamplingNdviService({
      repository: {
        ensureSchema: async () => {},
        findRecentCache: async () => null,
        upsertLayer: async (data) => ({
          ...data,
          id: 'fallback-layer',
          status: 'generated',
        }),
      },
      catalogClient: {
        polygonToBbox: () => [-54.48, -15.38, -54.47, -15.37],
        searchSentinelScenes: async () => [
          {
            scene_id: 'failed-scene',
            image_date: '2026-06-08',
            cloud_coverage: 2,
          },
          {
            scene_id: 'fallback-scene',
            image_date: '2026-06-06',
            cloud_coverage: 4,
          },
        ],
      },
      processClient: {
        generateNdviLayer: async (params) => {
          calls.push(params.sceneId);
          if (params.sceneId === 'failed-scene') {
            throw Object.assign(new Error('Copernicus falhou para a cena'), {
              code: 'copernicus_error',
              status: 502,
            });
          }
          return {
            preview_url: 'https://cdn.example/fallback.png',
            ndvi_mean: 0.62,
            ndvi_min: 0.35,
            ndvi_max: 0.81,
            very_low_percent: 5,
            low_percent: 25,
            medium_percent: 40,
            high_percent: 30,
            contrast,
            visual_mode: params.visualMode,
            raster_validation: validRaster,
            bounds,
            status: 'generated',
          };
        },
      },
      authClient: { isConfigured: () => true },
    });

    const layer = await service.generateLayer({
      farmId: 'f1',
      plotId: 'p1',
      campaignId: '16',
      sceneId: 'failed-scene',
      polygon,
      imageDate: '2026-06-08',
      visualMode: 'ndvi_contrast',
    });

    assert.deepEqual(calls, ['failed-scene', 'fallback-scene']);
    assert.equal(layer.scene_id, 'fallback-scene');
    assert.equal(layer.preview_url, 'https://cdn.example/fallback.png');
  });

  it('gera modo avançado via Copernicus quando raster persistido ainda não existe', async () => {
    let requestedMode = null;
    const savedRow = {
      id: 'layer-moisture',
      scene_id: 'scene-abc',
      farm_id: 'f1',
      plot_id: 'p1',
      campaign_id: '16',
      source: 'sentinel_2_l2a',
      image_date: '2026-05-25',
      status: 'generated',
      preview_url: 'https://cdn.example/ndmi.png',
      ndvi_mean: 0.62,
      ndvi_min: 0.35,
      ndvi_max: 0.81,
      very_low_percent: 5,
      low_percent: 25,
      medium_percent: 40,
      high_percent: 30,
      visual_mode: 'ndmi_water_stress',
      is_active: false,
    };

    const service = new SoilSamplingNdviService({
      repository: {
        ensureSchema: async () => {},
        findRecentCache: async () => null,
        upsertLayer: async (data) => ({ ...savedRow, ...data, id: savedRow.id }),
      },
      catalogClient: { polygonToBbox: () => [-54.48, -15.38, -54.47, -15.37] },
      processClient: {
        generateNdviLayer: async (params) => {
          requestedMode = params.visualMode;
          return {
            preview_url: 'https://cdn.example/ndmi.png',
            ndvi_mean: 0.62,
            ndvi_min: 0.35,
            ndvi_max: 0.81,
            very_low_percent: 5,
            low_percent: 25,
            medium_percent: 40,
            high_percent: 30,
            contrast,
            visual_mode: 'ndmi_water_stress',
            raster_validation: validRaster,
            bounds,
            status: 'generated',
          };
        },
      },
      authClient: { isConfigured: () => true },
    });

    const layer = await service.generateLayer({
      farmId: 'f1',
      plotId: 'p1',
      campaignId: '16',
      sceneId: 'scene-abc',
      polygon,
      imageDate: '2026-05-25',
      visualMode: 'ndmi_water_stress',
      force: true,
    });

    assert.equal(requestedMode, 'ndmi_water_stress');
    assert.equal(layer.visual_mode, 'ndmi_water_stress');
    assert.equal(layer.preview_url, 'https://cdn.example/ndmi.png');
    assert.equal(layer.status, 'ready');
  });

  it('422 quando preview existe mas stats NDVI inválidas (mean zero)', async () => {
    const service = new SoilSamplingNdviService({
      repository: {
        ensureSchema: async () => {},
        findRecentCache: async () => null,
        upsertLayer: async () => {
          throw new Error('should not persist');
        },
      },
      catalogClient: { polygonToBbox: () => [-54.48, -15.38, -54.47, -15.37] },
      processClient: {
        generateNdviLayer: async () => ({
          preview_url: 'https://cdn.example/ndvi.png',
          ndvi_mean: 0,
          ndvi_min: 0,
          ndvi_max: 0,
          very_low_percent: 22,
          low_percent: 36,
          medium_percent: 36,
          high_percent: 6,
          status: 'generated',
        }),
      },
      authClient: { isConfigured: () => true },
    });

    await assert.rejects(
      () =>
        service.generateLayer({
          farmId: 'f1',
          plotId: 'p1',
          campaignId: '16',
          sceneId: 'scene-abc',
          polygon,
          imageDate: '2026-05-25',
        }),
      (err) =>
        err.code === 'ndvi_not_computed' &&
        err.status === 422 &&
        err.details?.reason === 'zero_stats' &&
        err.details?.previewGenerated === true &&
        err.details?.statsComputed === false,
    );
  });

  it('ignora cache com stats zeradas e gera nova camada', async () => {
    const badCache = {
      id: 'bad-layer',
      scene_id: 'scene-abc',
      farm_id: 'f1',
      plot_id: 'p1',
      campaign_id: '16',
      source: 'sentinel_2_l2a',
      image_date: '2026-05-25',
      status: 'generated',
      preview_url: 'https://cdn.example/old.png',
      ndvi_mean: 0,
      ndvi_min: 0,
      ndvi_max: 0,
      very_low_percent: 22,
      low_percent: 36,
      medium_percent: 36,
      high_percent: 6,
      is_active: false,
    };

    const savedRow = {
      id: 'layer-new',
      scene_id: 'scene-abc',
      farm_id: 'f1',
      plot_id: 'p1',
      campaign_id: '16',
      source: 'sentinel_2_l2a',
      image_date: '2026-05-25',
      status: 'generated',
      preview_url: 'https://cdn.example/ndvi.png',
      ndvi_mean: 0.62,
      ndvi_min: 0.35,
      ndvi_max: 0.81,
      very_low_percent: 5,
      low_percent: 25,
      medium_percent: 40,
      high_percent: 30,
      is_active: false,
    };

    let upsertCalls = 0;
    const service = new SoilSamplingNdviService({
      repository: {
        ensureSchema: async () => {},
        findRecentCache: async () => badCache,
        upsertLayer: async (data) => {
          upsertCalls += 1;
          return { ...savedRow, ...data, id: savedRow.id };
        },
      },
      catalogClient: { polygonToBbox: () => [-54.48, -15.38, -54.47, -15.37] },
      processClient: {
        generateNdviLayer: async () => ({
          preview_url: 'https://cdn.example/ndvi.png',
          ndvi_mean: 0.62,
          ndvi_min: 0.35,
          ndvi_max: 0.81,
          very_low_percent: 5,
          low_percent: 25,
          medium_percent: 40,
          high_percent: 30,
          contrast,
          visual_mode: 'ndvi_contrast',
          raster_validation: validRaster,
          bounds,
          status: 'generated',
        }),
      },
      authClient: { isConfigured: () => true },
    });

    const layer = await service.generateLayer({
      farmId: 'f1',
      plotId: 'p1',
      campaignId: '16',
      sceneId: 'scene-abc',
      polygon,
      imageDate: '2026-05-25',
    });

    assert.equal(layer.status, 'ready');
    assert.equal(upsertCalls, 1);
  });

  it('retorna camada efêmera quando persist falha mas há preview', async () => {
    const service = new SoilSamplingNdviService({
      repository: {
        ensureSchema: async () => {},
        findRecentCache: async () => null,
        upsertLayer: async () => {
          throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
        },
      },
      catalogClient: { polygonToBbox: () => [-54.48, -15.38, -54.47, -15.37] },
      processClient: {
        generateNdviLayer: async () => ({
          preview_url: 'https://cdn.example/ndvi.png',
          ndvi_mean: 0.62,
          ndvi_min: 0.35,
          ndvi_max: 0.81,
          very_low_percent: 5,
          low_percent: 25,
          medium_percent: 40,
          high_percent: 30,
          contrast,
          visual_mode: 'ndvi_contrast',
          raster_validation: validRaster,
          bounds,
          status: 'generated',
        }),
      },
      authClient: { isConfigured: () => true },
    });

    const layer = await service.generateLayer({
      farmId: 'f1',
      plotId: 'p1',
      campaignId: '16',
      sceneId: 'scene-abc',
      polygon,
      imageDate: '2026-05-25',
    });

    assert.equal(layer.status, 'ready');
    assert.equal(layer.preview_url, 'https://cdn.example/ndvi.png');
    assert.ok(layer.id);
  });
});

describe('SceneBandPackage generate-package', () => {
  it('registra rotas compatíveis para generate-package', () => {
    const router = createSoilSamplingNdviRouter({
      pool: { query: async () => ({ rows: [] }) },
      publicBaseUrl: '',
    });
    const paths = router.stack
      .map((layer) => layer.route?.path)
      .filter(Boolean);

    assert.ok(paths.includes('/plots/:plotId/generate-package'));
    assert.ok(paths.includes('/generate-package'));
    assert.ok(paths.includes('/ndvi/generate-package'));
  });

  it('retorna ndviContrast ready e mantém moisture como failed/unavailable', async () => {
    const calls = [];
    const service = new SoilSamplingNdviService({
      repository: {
        ensureSchema: async () => {},
        findRecentCache: async () => null,
        upsertLayer: async (data) => ({ ...data, id: `${data.visual_mode}-layer` }),
      },
      catalogClient: { polygonToBbox: () => [-54.48, -15.38, -54.47, -15.37] },
      processClient: {
        generateNdviLayer: async (params) => {
          calls.push({ mode: params.visualMode, imageDate: params.imageDate });
          if (params.visualMode === 'ndmi_water_stress') {
            throw Object.assign(new Error('Banda B11 ausente para Umidade.'), {
              code: 'missingBands',
              status: 422,
            });
          }
          return {
            preview_url: `https://cdn.example/${params.visualMode}.png`,
            ndvi_mean: 0.62,
            ndvi_min: 0.35,
            ndvi_max: 0.81,
            very_low_percent: 5,
            low_percent: 25,
            medium_percent: 40,
            high_percent: 30,
            contrast,
            visual_mode: params.visualMode,
            raster_validation: validRaster,
            bounds,
            status: 'generated',
          };
        },
      },
      authClient: { isConfigured: () => true },
    });

    const result = await service.generateLayerPackage({
      farmId: 'f1',
      plotId: 'p1',
      campaignId: '16',
      sceneId: 'S2A_MSIL2A_20260608T135131_N0512_R024_T21LYD_20260608T212815',
      polygon,
      imageDate: '2026-06-15',
      modes: ['ndvi_contrast', 'ndmi_water_stress'],
    });

    assert.equal(result.packageStatus, 'partial');
    assert.ok(result.packageCacheKey);
    assert.deepEqual(calls, [
      { mode: 'ndvi_contrast', imageDate: '2026-06-08' },
      { mode: 'ndmi_water_stress', imageDate: '2026-06-08' },
    ]);
    assert.equal(result.layersByMode.ndvi_contrast.status, 'ready');
    assert.equal(result.statusesByMode.ndvi_contrast.status, 'ready');
    assert.equal(result.layersByMode.ndmi_water_stress, undefined);
    assert.match(
      result.statusesByMode.ndmi_water_stress.status,
      /^(failed|unavailable)$/,
    );
  });

  it('usa GEE como provider preferencial de generate-package quando configurado', async () => {
    const previousEnv = {
      NDVI_PROVIDER: process.env.NDVI_PROVIDER,
      NDVI_PACKAGE_PROVIDER: process.env.NDVI_PACKAGE_PROVIDER,
      GEE_ALLOW_USAGE: process.env.GEE_ALLOW_USAGE,
      GEE_ENABLED: process.env.GEE_ENABLED,
      GEE_CLIENT_EMAIL: process.env.GEE_CLIENT_EMAIL,
      GEE_PRIVATE_KEY: process.env.GEE_PRIVATE_KEY,
    };
    process.env.NDVI_PROVIDER = 'copernicus';
    process.env.NDVI_PACKAGE_PROVIDER = 'gee';
    process.env.GEE_ALLOW_USAGE = 'true';
    delete process.env.GEE_ENABLED;
    process.env.GEE_CLIENT_EMAIL = 'gee@example.com';
    process.env.GEE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----';

    const geeCalls = [];
    try {
      const service = new SoilSamplingNdviService({
        repository: {
          ensureSchema: async () => {},
          findRecentCache: async () => null,
          upsertLayer: async (data) => ({ ...data, id: `${data.visual_mode}-layer` }),
        },
        catalogClient: { polygonToBbox: () => [-54.48, -15.38, -54.47, -15.37] },
        processClient: {
          generateLayerPackage: async () => assert.fail('Copernicus package should not be called'),
          generateNdviLayer: async () => assert.fail('Copernicus per-mode fallback should not be called'),
        },
        authClient: { isConfigured: () => false },
        geeClient: {
          isImplemented: () => true,
          generateLayerPackage: async (params) => {
            geeCalls.push(params);
            const layerFor = (mode) => ({
              preview_url: `https://cdn.example/gee-${mode}.png`,
              ndvi_mean: 0.62,
              ndvi_min: 0.35,
              ndvi_max: 0.81,
              very_low_percent: 5,
              low_percent: 25,
              medium_percent: 40,
              high_percent: 30,
              contrast,
              visual_mode: mode,
              raster_validation: validRaster,
              bounds,
              status: 'generated',
            });
            return {
              scene_id: params.sceneId,
              packageCacheKey: 'gee-package-key',
              layersByMode: {
                ndvi_absolute: layerFor('ndvi_absolute'),
                ndmi_water_stress: layerFor('ndmi_water_stress'),
              },
              statusesByMode: {
                ndre: {
                  status: 'unavailable',
                  code: 'missingBandB05',
                  message: 'Banda B05 ausente para Red Edge/NDRE.',
                },
              },
            };
          },
        },
      });

      const result = await service.generateLayerPackage({
        farmId: 'f1',
        plotId: 'p1',
        campaignId: '16',
        sceneId: 'S2A_MSIL2A_20260608T135131_N0512_R024_T21LYD_20260608T212815',
        polygon,
        imageDate: '2026-06-08',
        modes: ['ndre', 'ndmi_water_stress', 'ndvi_absolute'],
      });

      assert.equal(geeCalls.length, 1);
      assert.deepEqual(geeCalls[0].modes, [
        'ndvi_absolute',
        'ndmi_water_stress',
        'ndre',
      ]);
      assert.equal(result.provider, 'google_earth_engine');
      assert.equal(result.packageStatus, 'partial');
      assert.equal(result.packageCacheKey, 'gee-package-key');
      assert.equal(result.statusesByMode.ndvi_absolute.status, 'ready');
      assert.equal(result.statusesByMode.ndmi_water_stress.status, 'ready');
      assert.equal(result.statusesByMode.ndre.status, 'unavailable');
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('usa Copernicus primeiro na prévia rápida de NDVI básico', async () => {
    let geeCalls = 0;
    let copernicusCalls = 0;
    const service = new SoilSamplingNdviService({
      repository: {
        ensureSchema: async () => {},
        findRecentCache: async () => null,
        upsertLayer: async (data) => ({ ...data, id: 'fast-preview-layer' }),
      },
      catalogClient: { polygonToBbox: () => [-54.48, -15.38, -54.47, -15.37] },
      geeClient: {
        isImplemented: () => true,
        generateLayerPackage: async () => {
          geeCalls += 1;
          throw new Error('GEE não deve bloquear a prévia rápida');
        },
      },
      processClient: {
        generateLayerPackage: async () => {
          copernicusCalls += 1;
          return {
            scene_id: 'scene-fast',
            provider: 'copernicus_dataspace',
            layersByMode: {
              ndvi_absolute: {
                preview_url: 'https://cdn.example/copernicus-fast.png',
                ndvi_mean: 0.62,
                ndvi_min: 0.35,
                ndvi_max: 0.81,
                very_low_percent: 5,
                low_percent: 25,
                medium_percent: 40,
                high_percent: 30,
                visual_mode: 'ndvi_absolute',
                raster_validation: validRaster,
                bounds,
                status: 'generated',
              },
            },
            statusesByMode: {},
          };
        },
      },
      authClient: { isConfigured: () => true },
    });

    const result = await service.generateLayerPackage({
      farmId: 'f1',
      plotId: 'p1',
      campaignId: '16',
      sceneId: 'scene-fast',
      polygon,
      imageDate: '2026-06-08',
      modes: ['ndvi_absolute'],
      resolutionKind: 'fastPreview',
    });

    assert.equal(copernicusCalls, 1);
    assert.equal(geeCalls, 0);
    assert.equal(result.provider, 'copernicus_dataspace');
    assert.equal(result.layersByMode.ndvi_absolute.layerStatus, 'PREVIEW_READY');
  });

  it('marca pacote como failed quando nenhum modo fica pronto', async () => {
    const service = new SoilSamplingNdviService({
      repository: {
        ensureSchema: async () => {},
        findRecentCache: async () => null,
        upsertLayer: async () => {
          throw new Error('should not persist empty package');
        },
      },
      catalogClient: { polygonToBbox: () => [-54.48, -15.38, -54.47, -15.37] },
      processClient: {
        generateNdviLayer: async () => {
          throw Object.assign(new Error('Não foi possível gerar NDVI no provedor de imagens'), {
            code: 'NDVI_PROVIDER_ERROR',
            status: 502,
          });
        },
      },
      authClient: { isConfigured: () => true },
    });

    const result = await service.generateLayerPackage({
      farmId: 'f1',
      plotId: 'p1',
      campaignId: '16',
      sceneId: 'scene-abc',
      polygon,
      imageDate: '2026-05-25',
      modes: ['ndre'],
    });

    assert.equal(result.packageStatus, 'failed');
    assert.deepEqual(Object.keys(result.layersByMode), []);
    assert.equal(result.statusesByMode.ndre.status, 'failed');
  });
});

describe('SoilSamplingNdviService.searchScenes', () => {
  it('prioriza GEE quando pacote GEE está preferido e Copernicus falha', async () => {
    const previousEnv = {
      NDVI_PROVIDER: process.env.NDVI_PROVIDER,
      NDVI_PACKAGE_PROVIDER: process.env.NDVI_PACKAGE_PROVIDER,
      GEE_ALLOW_USAGE: process.env.GEE_ALLOW_USAGE,
      GEE_CLIENT_EMAIL: process.env.GEE_CLIENT_EMAIL,
      GEE_PRIVATE_KEY: process.env.GEE_PRIVATE_KEY,
    };
    process.env.NDVI_PROVIDER = 'copernicus';
    process.env.NDVI_PACKAGE_PROVIDER = 'gee';
    process.env.GEE_ALLOW_USAGE = 'true';
    process.env.GEE_CLIENT_EMAIL = 'gee@example.com';
    process.env.GEE_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----';

    try {
      const service = new SoilSamplingNdviService({
        repository: {
          ensureSchema: async () => {},
          listByPlot: async () => [],
        },
        catalogClient: {
          polygonToBbox: () => [-54.48, -15.38, -54.47, -15.37],
          searchSentinelScenes: async () => {
            throw Object.assign(new Error('Timeout ao consultar catálogo Sentinel'), {
              code: 'copernicus_timeout',
              status: 504,
            });
          },
        },
        processClient: {},
        authClient: { isConfigured: () => true },
        geeClient: {
          isImplemented: () => true,
          searchScenes: async () => [
            {
              scene_id: 'gee-scene-1',
              id: 'gee-scene-1',
              image_date: '2026-06-08',
              cloud_coverage: 4,
              source: 'gee_sentinel_2_l2a',
            },
          ],
        },
      });

      const scenes = await service.searchScenes({
        farmId: 'f1',
        plotId: 'p1',
        campaignId: '16',
        polygon,
        startDate: '2026-01-01',
        endDate: '2026-07-20',
        maxCloud: 40,
      });

      assert.equal(scenes.length, 1);
      assert.equal(scenes[0].scene_id || scenes[0].id, 'gee-scene-1');
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
