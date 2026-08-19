import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SURFACE_CLASS,
  aggregateSurfaceClassPixels,
  classifySurfacePixel,
  computeSurfaceIndices,
  isCdseSurfaceCoverMode,
} from './ndviSurfaceCoverCore.js';

describe('ndviSurfaceCoverCore', () => {
  it('NDVI isolado é inconclusivo — não palhada nem vigor', () => {
    const r = classifySurfacePixel({
      dataMask: 1,
      SCL: 4,
      B04: 0.12,
      B08: 0.18,
    });
    assert.equal(r.classCode, SURFACE_CLASS.INCONCLUSIVE);
  });

  it('NDVI alto sem NDRE/SAVI não é vegetação residual', () => {
    const r = classifySurfacePixel({
      dataMask: 1,
      SCL: 4,
      B04: 0.04,
      B08: 0.45,
    });
    assert.equal(r.classCode, SURFACE_CLASS.INCONCLUSIVE);
  });

  it('vegetação residual exige NDVI+NDRE', () => {
    const r = classifySurfacePixel({
      dataMask: 1,
      SCL: 4,
      B02: 0.05,
      B04: 0.08,
      B05: 0.12,
      B08: 0.40,
      B8A: 0.42,
      B11: 0.12,
    });
    assert.equal(r.classCode, SURFACE_CLASS.GREEN_RESIDUAL);
    assert.ok(r.confidence >= 0.6);
  });

  it('palhada exige NBR2 (B12)', () => {
    const noB12 = classifySurfacePixel({
      dataMask: 1,
      SCL: 5,
      B02: 0.1,
      B04: 0.12,
      B05: 0.18,
      B08: 0.18,
      B8A: 0.19,
      B11: 0.22,
    });
    const withB12 = classifySurfacePixel({
      dataMask: 1,
      SCL: 5,
      B02: 0.1,
      B04: 0.12,
      B05: 0.18,
      B08: 0.18,
      B8A: 0.19,
      B11: 0.22,
      B12: 0.16,
    });
    assert.equal(noB12.classCode, SURFACE_CLASS.INCONCLUSIVE);
    assert.equal(withB12.classCode, SURFACE_CLASS.DRY_RESIDUE);
  });

  it('solo exposto: NDVI baixo + BSI', () => {
    const r = classifySurfacePixel({
      dataMask: 1,
      SCL: 5,
      B02: 0.2,
      B04: 0.25,
      B05: 0.1,
      B08: 0.12,
      B8A: 0.12,
      B11: 0.40,
    });
    assert.equal(r.classCode, SURFACE_CLASS.BARE_DRY);
  });

  it('agrega inconclusivo na área válida', () => {
    const pixels = [
      { classCode: 0, confidence: 0.4 },
      { classCode: 1, confidence: 0.82 },
      { classCode: 4, confidence: 0.78 },
      { classCode: 7, confidence: 0 },
    ];
    for (let i = 0; i < 20; i += 1) {
      pixels.push({ classCode: 0, confidence: 0.4 });
    }
    const stats = aggregateSurfaceClassPixels(pixels, { resolutionM: 20 });
    assert.equal(stats.status, 'ok');
    assert.ok(stats.classAreas.some((c) => c.classId === 'unknown'));
    assert.ok(stats.inconclusive_percent > 0);
  });

  it('B05 ausente não inventa NDRE', () => {
    const idx = computeSurfaceIndices({ B04: 0.1, B08: 0.4 });
    assert.ok(Number.isFinite(idx.ndvi));
    assert.equal(idx.ndre, null);
  });

  it('modos de cobertura CDSE', () => {
    assert.equal(isCdseSurfaceCoverMode('post_harvest_cover'), true);
    assert.equal(isCdseSurfaceCoverMode('bsi_soil'), true);
    assert.equal(isCdseSurfaceCoverMode('ndvi_absolute'), false);
  });
});
