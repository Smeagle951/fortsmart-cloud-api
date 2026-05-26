import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeScenesByDate,
  formatSceneForApi,
  resolveSceneStatus,
  sortScenesForDisplay,
} from './ndviScenePipeline.js';

describe('ndviScenePipeline', () => {
  it('remove duplicatas por data mantendo menor nuvem', () => {
    const scenes = dedupeScenesByDate([
      { id: 'a', scene_id: 'a', image_date: '2026-05-25', cloud_coverage: 12 },
      { id: 'b', scene_id: 'b', image_date: '2026-05-25', cloud_coverage: 5 },
      { id: 'c', scene_id: 'c', image_date: '2026-05-20', cloud_coverage: 8 },
    ]);
    assert.equal(scenes.length, 2);
    const may25 = scenes.find((s) => s.image_date === '2026-05-25');
    assert.equal(may25.cloud_coverage, 5);
  });

  it('ordena por data mais recente primeiro', () => {
    const sorted = sortScenesForDisplay([
      { image_date: '2026-05-10', cloud_coverage: 1 },
      { image_date: '2026-05-25', cloud_coverage: 20 },
      { image_date: '2026-05-20', cloud_coverage: 2 },
    ]);
    assert.equal(sorted[0].image_date, '2026-05-25');
    assert.equal(sorted[2].image_date, '2026-05-10');
  });

  it('sem preview não usa status available', () => {
    assert.equal(
      resolveSceneStatus({ image_date: '2026-05-25', cloud_coverage: 10 }),
      'metadata_only',
    );
    assert.equal(
      resolveSceneStatus({
        preview_url: 'https://cdn/p.png',
        ndvi_mean: 0.72,
        layer_status: 'generated',
        layer_id: 'layer-1',
      }),
      'ready',
    );
  });

  it('miniatura STAC sem camada NDVI usa status available', () => {
    assert.equal(
      resolveSceneStatus({
        image_date: '2026-05-25',
        thumbnail_url: 'https://thumb',
      }),
      'available',
    );
    const api = formatSceneForApi({
      id: 'scene-1',
      scene_id: 'scene-1',
      image_date: '2026-05-25',
      cloud_coverage: 7,
      thumbnail_url: 'https://thumb',
    });
    assert.equal(api.status, 'available');
    assert.equal(api.thumbnailUrl, 'https://thumb');
  });

  it('formatSceneForApi expõe aliases camelCase quando NDVI gerado', () => {
    const api = formatSceneForApi({
      id: 'scene-1',
      scene_id: 'scene-1',
      image_date: '2026-05-25',
      cloud_coverage: 7,
      preview_url: 'https://cdn/ndvi.png',
      thumbnail_url: 'https://thumb',
      ndvi_mean: 0.65,
      layer_id: 'layer-1',
      layer_status: 'generated',
    });
    assert.equal(api.cloudPercent, 7);
    assert.equal(api.meanNdvi, 0.65);
    assert.equal(api.status, 'ready');
  });
});
