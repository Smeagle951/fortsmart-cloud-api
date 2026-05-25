import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import SoilSamplingNdviService from './soilSamplingNdvi.service.js';
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
    assert.equal(layer.status, 'generated');
    assert.ok(NdviResponseMapper.mapLayer(savedRow));
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

    assert.equal(layer.status, 'generated');
    assert.equal(layer.preview_url, 'https://cdn.example/ndvi.png');
    assert.ok(layer.id);
  });
});
