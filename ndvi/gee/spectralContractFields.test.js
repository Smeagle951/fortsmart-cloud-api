/**
 * Contrato GEE: recommendation / quality / warnings (unitário puro).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

// Espelha buildSpectralContractFields sem carregar EE.
const VISUAL_MODES = {
  NDVI_CONTRAST: 'ndvi_contrast',
  NDRE: 'ndre',
  POST_HARVEST_COVER: 'post_harvest_cover',
};

function selectedBandForMode(mode) {
  if (mode === VISUAL_MODES.POST_HARVEST_COVER) return 'SURFACE_CLASS';
  if (mode === VISUAL_MODES.NDRE) return 'NDRE';
  return 'NDVI';
}

function renderTypeForMode(mode) {
  return mode === VISUAL_MODES.POST_HARVEST_COVER ? 'categorical' : 'continuous';
}

function buildSpectralContractFields({ mode, objective = 'recommended', maskStats = {}, stats = {} }) {
  const warnings = [];
  if (mode === VISUAL_MODES.POST_HARVEST_COVER) {
    warnings.push('Classificação pós-colheita em calibração');
  }
  if (mode === VISUAL_MODES.NDVI_CONTRAST) {
    warnings.push('Contraste relativo é só inspeção');
  }
  if (Number(maskStats.validPixelPercent) < 60) {
    warnings.push('Poucos pixels válidos');
  }
  return {
    recommendation: {
      objective,
      visualMode: mode,
      selectedBand: selectedBandForMode(mode),
      renderType: renderTypeForMode(mode),
    },
    quality: {
      validPixelCount: maskStats.validPixels ?? null,
      validPixelPercent: maskStats.validPixelPercent ?? null,
    },
    warnings,
  };
}

test('post_harvest_cover emite recommendation categórica SURFACE_CLASS', () => {
  const out = buildSpectralContractFields({
    mode: VISUAL_MODES.POST_HARVEST_COVER,
    objective: 'post_harvest_cover',
    maskStats: { validPixels: 400, validPixelPercent: 85 },
  });
  assert.equal(out.recommendation.selectedBand, 'SURFACE_CLASS');
  assert.equal(out.recommendation.renderType, 'categorical');
  assert.ok(out.warnings.some((w) => /calibração/i.test(w)));
});

test('contraste relativo gera warning de inspeção', () => {
  const out = buildSpectralContractFields({
    mode: VISUAL_MODES.NDVI_CONTRAST,
    maskStats: { validPixels: 100, validPixelPercent: 90 },
  });
  assert.ok(out.warnings.some((w) => /inspeção/i.test(w)));
});

test('poucos pixels válidos gera warning de qualidade', () => {
  const out = buildSpectralContractFields({
    mode: VISUAL_MODES.NDRE,
    maskStats: { validPixels: 10, validPixelPercent: 40 },
  });
  assert.ok(out.warnings.some((w) => /pixels válidos/i.test(w)));
  assert.equal(out.quality.validPixelPercent, 40);
});
