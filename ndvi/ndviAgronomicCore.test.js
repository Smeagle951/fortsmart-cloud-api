import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGRONOMIC_CLASS,
  aggregateAgronomicPixels,
  classifyAgronomicPixel,
  computeIndices,
  previewRgbForClass,
} from './ndviAgronomicCore.js';

describe('ndviAgronomicCore', () => {
  it('pixel com NDVI alto vira high_vigor ou very_high_vigor', () => {
    const cid = classifyAgronomicPixel({
      dataMask: 1,
      SCL: 4,
      B02: 0.05,
      B04: 0.04,
      B05: 0.08,
      B08: 0.45,
      B8A: 0.46,
      B11: 0.12,
    });
    assert.ok(
      cid === AGRONOMIC_CLASS.HIGH_VIGOR ||
        cid === AGRONOMIC_CLASS.VERY_HIGH_VIGOR,
    );
  });

  it('pixel com NDVI baixo + BSI alto vira bare_soil', () => {
    const cid = classifyAgronomicPixel({
      dataMask: 1,
      SCL: 5,
      B02: 0.2,
      B04: 0.25,
      B05: 0.1,
      B08: 0.12,
      B8A: 0.12,
      B11: 0.35,
    });
    assert.equal(cid, AGRONOMIC_CLASS.BARE_SOIL);
  });

  it('NDVI+SWIR sem B12 não classifica palhada', () => {
    const cid = classifyAgronomicPixel({
      dataMask: 1,
      SCL: 5,
      B02: 0.1,
      B04: 0.12,
      B05: 0.11,
      B08: 0.18,
      B8A: 0.19,
      B11: 0.14,
    });
    assert.equal(cid, AGRONOMIC_CLASS.SKIP);
  });

  it('palhada exige NBR2 (B11+B12) e NDRE baixo', () => {
    const cid = classifyAgronomicPixel({
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
    assert.equal(cid, AGRONOMIC_CLASS.STRAW);
  });

  it('NDVI alto sem B05 não vira vigor (inconclusivo)', () => {
    const cid = classifyAgronomicPixel({
      dataMask: 1,
      SCL: 4,
      B04: 0.04,
      B08: 0.45,
    });
    assert.equal(cid, AGRONOMIC_CLASS.SKIP);
  });

  it('NDRE baixo com NDVI de dossel vira stress_candidate', () => {
    const cid = classifyAgronomicPixel({
      dataMask: 1,
      SCL: 4,
      B02: 0.08,
      B04: 0.20,
      B05: 0.12,
      B08: 0.55,
      B8A: 0.13,
      B11: 0.48,
    });
    assert.equal(cid, AGRONOMIC_CLASS.STRESS_CANDIDATE);
  });

  it('SCL cloud remove pixel (water_cloud_shadow)', () => {
    const cid = classifyAgronomicPixel({
      dataMask: 1,
      SCL: 9,
      B02: 0.1,
      B04: 0.2,
      B08: 0.5,
      B11: 0.1,
    });
    assert.equal(cid, AGRONOMIC_CLASS.WATER_CLOUD_SHADOW);
  });

  it('preview agronomic_classes usa cores distintas por classe', () => {
    const a = previewRgbForClass(AGRONOMIC_CLASS.BARE_SOIL);
    const b = previewRgbForClass(AGRONOMIC_CLASS.HIGH_VIGOR);
    const c = previewRgbForClass(AGRONOMIC_CLASS.VERY_HIGH_VIGOR);
    assert.notDeepEqual(a, b);
    assert.notDeepEqual(b, c);
  });

  it('aggregate retorna percentuais de classes', () => {
    const pixels = [
      { valid: true, ndvi: 0.75, classId: AGRONOMIC_CLASS.HIGH_VIGOR, ndre: 0.35 },
      { valid: true, ndvi: 0.82, classId: AGRONOMIC_CLASS.VERY_HIGH_VIGOR, ndre: 0.4 },
      { valid: true, ndvi: 0.15, classId: AGRONOMIC_CLASS.BARE_SOIL, ndre: 0.1 },
    ];
    for (let i = 0; i < 30; i += 1) {
      pixels.push({
        valid: true,
        ndvi: 0.55,
        classId: AGRONOMIC_CLASS.MEDIUM_VIGOR,
        ndre: 0.28,
      });
    }
    const stats = aggregateAgronomicPixels(pixels);
    assert.ok(stats);
    assert.ok(stats.high_vigor_percent >= 0);
    assert.ok(stats.bare_soil_percent >= 0);
    assert.ok(stats.classes.bareSoilPercent >= 0);
    const sum =
      stats.bare_soil_percent +
      stats.high_vigor_percent +
      stats.very_high_vigor_percent +
      stats.medium_vigor_percent;
    assert.ok(sum >= 95 && sum <= 105);
  });

  it('índices NDRE/SAVI/BSI/NDMI são finitos', () => {
    const idx = computeIndices({
      B02: 0.1,
      B04: 0.12,
      B05: 0.11,
      B08: 0.35,
      B8A: 0.36,
      B11: 0.15,
    });
    assert.ok(Number.isFinite(idx.ndvi));
    assert.ok(Number.isFinite(idx.ndre));
    assert.ok(Number.isFinite(idx.savi));
    assert.ok(Number.isFinite(idx.bsi));
    assert.ok(Number.isFinite(idx.ndmi));
    assert.equal(idx.nbr2, null);
  });

  it('B05 ausente deixa NDRE nulo — não inventa red-edge', () => {
    const idx = computeIndices({ B04: 0.1, B08: 0.4 });
    assert.ok(Number.isFinite(idx.ndvi));
    assert.equal(idx.ndre, null);
  });
});
