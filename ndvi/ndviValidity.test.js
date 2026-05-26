import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStatsOrNull,
  invalidNdviStatsReason,
  isValidNdviMean,
  isValidNdviStats,
  resolveLayerStatus,
} from './ndviValidity.js';
import { resolveSceneStatus } from './ndviScenePipeline.js';

describe('ndviValidity', () => {
  it('não inventa ndvi_mean 0.55 quando ausente', () => {
    const stats = buildStatsOrNull({ ndviMean: null, hasRaster: true });
    assert.equal(stats.ndvi_mean, null);
  });

  it('rejeita ndvi_mean 0 sem raster', () => {
    assert.equal(isValidNdviMean(0, { hasRaster: false }), false);
  });

  it('rejeita ndvi_mean 0 mesmo com raster', () => {
    assert.equal(isValidNdviMean(0, { hasRaster: true }), false);
  });

  it('ready exige preview e média', () => {
    assert.equal(
      resolveLayerStatus({
        status: 'generated',
        preview_url: 'https://cdn/x.png',
        ndvi_mean: 0.62,
        ndvi_min: 0.35,
        ndvi_max: 0.81,
        very_low_percent: 10,
        low_percent: 20,
        medium_percent: 30,
        high_percent: 40,
      }),
      'ready',
    );
  });

  it('invalidNdviStatsReason detecta zero_stats com percentuais', () => {
    assert.equal(
      invalidNdviStatsReason({
        ndvi_mean: 0,
        ndvi_min: 0,
        ndvi_max: 0,
        very_low_percent: 22,
        low_percent: 36,
        medium_percent: 36,
        high_percent: 6,
      }),
      'zero_stats',
    );
  });

  it('rejeita stats com mean zero e percentuais variados', () => {
    assert.equal(
      isValidNdviStats({
        ndvi_mean: 0,
        ndvi_min: 0,
        ndvi_max: 0,
        very_low_percent: 22,
        low_percent: 36,
        medium_percent: 36,
        high_percent: 6,
      }),
      false,
    );
  });

  it('rejeita percentuais que não somam ~100', () => {
    assert.equal(
      isValidNdviStats({
        ndvi_mean: 0.5,
        ndvi_min: 0.2,
        ndvi_max: 0.8,
        very_low_percent: 10,
        low_percent: 10,
        medium_percent: 10,
        high_percent: 10,
      }),
      false,
    );
  });

  it('aceita stats válidas com percentuais coerentes', () => {
    assert.equal(
      isValidNdviStats({
        ndvi_mean: 0.55,
        ndvi_min: 0.2,
        ndvi_max: 0.9,
        very_low_percent: 10,
        low_percent: 20,
        medium_percent: 30,
        high_percent: 40,
      }),
      true,
    );
  });

  it('scenes sem preview retornam metadata_only ou available', () => {
    assert.equal(resolveSceneStatus({ image_date: '2026-05-25' }), 'metadata_only');
    assert.equal(
      resolveSceneStatus({
        image_date: '2026-05-25',
        thumbnail_url: 'https://thumb',
      }),
      'available',
    );
  });
});
