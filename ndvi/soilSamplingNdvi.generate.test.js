import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
