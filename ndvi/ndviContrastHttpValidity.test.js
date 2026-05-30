import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as NdviResponseMapper from './ndviResponse.mapper.js';
import {
  layerMeetsContrastContract,
  validateNdviContrastHttpResponse,
} from './ndviContrastHttpValidity.js';

describe('ndviContrastHttpValidity', () => {
  it('422 quando layer legacy sem contrast', () => {
    const layer = {
      layer_id: 'a',
      preview_url: 'https://cdn.example/p.png',
      ndvi_mean: 0.87,
      high_percent: 99.9,
    };
    const validation = validateNdviContrastHttpResponse(layer, 'ndvi_contrast');
    assert.equal(validation.ok, false);
    assert.equal(validation.statusToReturn, 422);
  });

  it('201 quando contrato ndvi_contrast completo', () => {
    const row = {
      id: 'layer-1',
      preview_url: 'https://cdn.example/p.png',
      visual_mode: 'ndvi_contrast',
      schema_version: 'ndvi_v3',
      ndvi_schema_version: 3,
      agronomic_stats: {
        schema_version: 'ndvi_v3',
        ndvi_schema_version: 3,
        visual_mode: 'ndvi_contrast',
        contrast: { p5: 0.35, p50: 0.55, p95: 0.75 },
        bounds: { west: -54.5, south: -15.4, east: -54.4, north: -15.3 },
      },
    };
    const layer = NdviResponseMapper.mapLayer(row);
    assert.equal(layerMeetsContrastContract(layer, 'ndvi_contrast'), true);
    const validation = validateNdviContrastHttpResponse(layer, 'ndvi_contrast');
    assert.equal(validation.ok, true);
    assert.equal(validation.statusToReturn, 201);
    assert.equal(validation.contrast.p50, 0.55);
  });

  it('422 quando schema v3 ausente mesmo com visual e contrast', () => {
    const layer = {
      layer_id: 'legacy-contrast',
      preview_url: 'https://cdn.example/p.png',
      visual_mode: 'ndvi_contrast',
      contrast: { p5: 0.35, p50: 0.55, p95: 0.75 },
      bounds: { west: -54.5, south: -15.4, east: -54.4, north: -15.3 },
    };
    const validation = validateNdviContrastHttpResponse(layer, 'ndvi_contrast');
    assert.equal(validation.ok, false);
    assert.equal(validation.schemaOk, false);
  });

  it('422 quando bounds extrapolam bbox do talhão', () => {
    const layer = {
      layer_id: 'too-large',
      preview_url: 'https://cdn.example/p.png',
      visual_mode: 'ndvi_contrast',
      schema_version: 'ndvi_v3',
      contrast: { p5: 0.35, p50: 0.55, p95: 0.75 },
      bounds: { west: -60, south: -20, east: -50, north: -10 },
    };
    const requestBounds = { west: -54.5, south: -15.4, east: -54.4, north: -15.3 };
    const validation = validateNdviContrastHttpResponse(layer, 'ndvi_contrast', {
      requestBounds,
    });
    assert.equal(validation.ok, false);
    assert.equal(validation.boundsMatchRequest, false);
  });

  it('422 quando layer vem marcado como legacy', () => {
    const layer = {
      layer_id: 'legacy-flag',
      preview_url: 'https://cdn.example/p.png',
      visual_mode: 'ndvi_contrast',
      schema_version: 'ndvi_v3',
      isLegacy: true,
      contrast: { p5: 0.35, p50: 0.55, p95: 0.75 },
      bounds: { west: -54.5, south: -15.4, east: -54.4, north: -15.3 },
    };
    const validation = validateNdviContrastHttpResponse(layer, 'ndvi_contrast');
    assert.equal(validation.ok, false);
    assert.equal(validation.legacy, true);
  });
});
