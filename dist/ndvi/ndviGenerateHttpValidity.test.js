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
        ndvi_std: 0.08,
        ndre_mean: 0.35,
        savi_mean: 0.52,
        bsi_mean: 0.11,
        ndmi_mean: 0.2,
        bare_soil_percent: 5,
        low_vigor_percent: 12,
        medium_vigor_percent: 28,
        high_vigor_percent: 35,
        very_high_vigor_percent: 15,
        stress_candidate_percent: 5,
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
        ndreMean: 0.3,
        saviMean: 0.48,
        bsiMean: 0.15,
        classes: {
          bareSoilPercent: 6,
          lowVigorPercent: 10,
          mediumVigorPercent: 30,
          highVigorPercent: 40,
        },
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
