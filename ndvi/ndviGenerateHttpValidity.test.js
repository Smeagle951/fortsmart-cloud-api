import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidNdviGenerateHttpPayload } from './ndviGenerateHttpValidity.js';

describe('ndviGenerateHttpValidity', () => {
  it('rejeita mean/min/max zero com percentuais (caso produção)', () => {
    assert.equal(
      isValidNdviGenerateHttpPayload({
        preview_url: 'https://x/p.png',
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

  it('rejeita mean ~0 com preview', () => {
    assert.equal(
      isValidNdviGenerateHttpPayload({
        preview_url: 'https://x/p.png',
        ndvi_mean: 0.0000001,
        ndvi_min: 0,
        ndvi_max: 0.2,
      }),
      false,
    );
  });

  it('aceita stats válidas com preview', () => {
    assert.equal(
      isValidNdviGenerateHttpPayload({
        preview_url: 'https://x/p.png',
        ndvi_mean: 0.63,
        ndvi_min: 0.18,
        ndvi_max: 0.89,
        very_low_percent: 5,
        low_percent: 25,
        medium_percent: 40,
        high_percent: 30,
      }),
      true,
    );
  });

  it('aceita aliases camelCase', () => {
    assert.equal(
      isValidNdviGenerateHttpPayload({
        previewUrl: 'https://x/p.png',
        ndviMean: 0.5,
        ndviMin: 0.2,
        ndviMax: 0.7,
      }),
      true,
    );
  });

  it('rejeita sem raster', () => {
    assert.equal(
      isValidNdviGenerateHttpPayload({
        ndvi_mean: 0.5,
        ndvi_min: 0.2,
        ndvi_max: 0.7,
      }),
      false,
    );
  });
});
