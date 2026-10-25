import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FASTCACHE_ARTIFACT_STATES,
  buildFastCachePackageKey,
  buildFastCacheResponseMeta,
  enrichStatusesWithFastCacheArtifacts,
  hashPolygonForPackage,
  resolveFastCacheArtifactState,
} from './ndviFastCacheKey.js';

describe('ndviFastCacheKey', () => {
  it('hashPolygonForPackage is stable for same polygon', () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    };
    const a = hashPolygonForPackage(polygon);
    const b = hashPolygonForPackage(polygon);
    assert.equal(a, b);
    assert.equal(a.length, 12);
  });

  it('buildFastCachePackageKey appends mode when visualMode set', () => {
    const base = buildFastCachePackageKey({
      farmId: 'f1',
      plotId: 'p1',
      sceneId: 'S1',
      acquisitionDate: '2025-01-01',
      polygonHash: 'abc',
    });
    const withMode = buildFastCachePackageKey({
      farmId: 'f1',
      plotId: 'p1',
      sceneId: 'S1',
      acquisitionDate: '2025-01-01',
      polygonHash: 'abc',
      visualMode: 'ndvi_contrast',
    });
    assert.equal(withMode, `${base}::ndvi_contrast`);
  });

  it('resolveFastCacheArtifactState maps preview to PREVIEW_READY', () => {
    const state = resolveFastCacheArtifactState({
      layer: { preview_url: 'https://cdn.example/preview.png' },
      status: { status: 'ready' },
    });
    assert.equal(state, FASTCACHE_ARTIFACT_STATES.PREVIEW_READY);
  });

  it('enrichStatusesWithFastCacheArtifacts sets fastCacheKey per mode', () => {
    const packageCacheKey = 'farm_plot_scene_hash_preview_v1';
    const { artifactStates, statusesByMode } = enrichStatusesWithFastCacheArtifacts({
      packageCacheKey,
      layersByMode: {
        ndvi_contrast: { preview_url: 'https://cdn.example/p.png' },
      },
      statusesByMode: {
        ndvi_contrast: { status: 'ready' },
      },
    });
    assert.equal(
      statusesByMode.ndvi_contrast.fastCacheKey,
      `${packageCacheKey}::ndvi_contrast`,
    );
    assert.equal(artifactStates.ndvi_contrast, FASTCACHE_ARTIFACT_STATES.PREVIEW_READY);
  });

  it('buildFastCacheResponseMeta includes version and flags', () => {
    const meta = buildFastCacheResponseMeta({
      packageCacheKey: 'key1',
      artifactStates: { ndvi_contrast: 'PREVIEW_READY' },
      fromCache: true,
      geeInvoked: false,
      totalMs: 42,
      requestId: 'pkg-1',
    });
    assert.equal(meta.version, 'fastcache_v1');
    assert.equal(meta.fromCache, true);
    assert.equal(meta.totalMs, 42);
  });
});
