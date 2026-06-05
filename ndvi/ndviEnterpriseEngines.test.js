import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyHistogramEqualization,
  countColorBucketsAfterEqualization,
  equalizationMetadata,
} from './ndviHistogramEqualization.js';
import {
  buildNdviRenderingMetadata,
  buildNdviSpatialMetrics,
} from './ndviSpatialVariabilityEngine.js';
import { buildNdviTemporalIntelligence } from './ndviTemporalIntelligenceEngine.js';
import { renderAgronomicContrastV2 } from './agronomicContrastRendererV2.js';
import { buildNdviRasterMetadata } from './ndviRasterMetadata.js';
import { buildNdviZones } from './ndviZoneBuilder.js';

test('CLAHE leve amplia buckets em talhão 0.80-0.92 sem alterar stats brutos', () => {
  const values = Array.from({ length: 120 }, (_, i) => 0.8 + (i / 119) * 0.12);
  const equalized = applyHistogramEqualization(values, {
    p5: 0.8,
    p95: 0.92,
    visualMode: 'ndvi_contrast',
  });
  assert.ok(countColorBucketsAfterEqualization(values, {
    p5: 0.8,
    p95: 0.92,
    visualMode: 'ndvi_contrast',
  }) > 4);
  assert.equal(Number(values[0].toFixed(2)), 0.8);
  assert.equal(Number(values.at(-1).toFixed(2)), 0.92);
  assert.notDeepEqual(equalized.slice(0, 5), values.slice(0, 5));
});

test('CLAHE fica limitado em talhão homogêneo 0.86-0.87', () => {
  const values = Array.from({ length: 60 }, (_, i) => 0.86 + (i / 59) * 0.01);
  const meta = equalizationMetadata({
    visualMode: 'ndvi_contrast',
    p5: 0.86,
    p95: 0.87,
  });
  assert.equal(meta.enabled, false);
  assert.equal(meta.method, 'disabled_low_contrast_guard');
});

test('spatial metrics distinguem contraste alto e homogeneidade alta sem transformar null em zero', () => {
  const high = buildNdviSpatialMetrics({
    ndvi_mean: 0.72,
    ndvi_std: 0.08,
    ndvi_p5: 0.55,
    ndvi_p25: 0.62,
    ndvi_p50: 0.72,
    ndvi_p75: 0.82,
    ndvi_p95: 0.9,
  });
  assert.equal(high.contrastSeverity, 'high');

  const low = buildNdviSpatialMetrics({
    ndvi_mean: 0.86,
    ndvi_std: 0.004,
    ndvi_p5: 0.85,
    ndvi_p95: 0.87,
  });
  assert.ok(low.homogeneityScore >= 75);

  const missing = buildNdviSpatialMetrics({});
  assert.equal(missing.percentBelowP25, null);
});

test('rendering metadata preserva fonte bruta para stats e visual suavizado', () => {
  assert.deepEqual(buildNdviRenderingMetadata(), {
    smoothing: 'median_3x3',
    interpolation: 'bilinear_4x',
    statsSource: 'raw_pixels',
    previewSource: 'smoothed_visual',
  });
});

test('temporal intelligence detecta queda, expansão e histórico insuficiente', () => {
  assert.equal(buildNdviTemporalIntelligence([]).status, 'insufficient_history');

  const result = buildNdviTemporalIntelligence([
    {
      image_date: '2026-05-01',
      ndvi_mean: 0.82,
      spatial_metrics: { percentBelowP25: 14 },
    },
    {
      image_date: '2026-05-20',
      ndvi_mean: 0.75,
      spatial_metrics: { percentBelowP25: 24 },
    },
  ]);

  assert.equal(result.temporalDecline, true);
  assert.equal(result.expandingLowVigorZone, true);
  assert.equal(result.status, 'worsening');
});

test('renderer v2 gera múltiplos buckets e preserva stats brutos', () => {
  const values = Array.from({ length: 100 }, (_, i) => 0.8 + (i / 99) * 0.12);
  const before = [...values];
  const rendered = renderAgronomicContrastV2({
    values,
    width: 10,
    height: 10,
    visualMode: 'ndvi_contrast',
  });
  assert.equal(rendered.contrast.rendererVersion, 'agronomic_contrast_v2_1');
  assert.equal(values[0], before[0]);
  assert.equal(values.at(-1), before.at(-1));
  const activeBuckets = Object.values(rendered.contrast.colorBuckets).filter((v) => v > 0);
  assert.ok(activeBuckets.length >= 4);
});

test('renderer v2 marca lowContrastScene quando range é muito baixo', () => {
  const values = Array.from({ length: 100 }, (_, i) => 0.86 + (i / 99) * 0.01);
  const rendered = renderAgronomicContrastV2({
    values,
    width: 10,
    height: 10,
    visualMode: 'ndvi_contrast',
  });
  assert.equal(rendered.contrast.lowContrastScene, true);
  assert.ok(Math.min(...rendered.visualValues.filter(Number.isFinite)) >= 0.85);
  assert.ok(Math.max(...rendered.visualValues.filter(Number.isFinite)) <= 0.88);
  assert.equal(rendered.contrast.equalization.enabled, false);
});

test('raster metadata diferencia raster interno de preview', () => {
  const meta = buildNdviRasterMetadata({
    grid: { values: [0.4, 0.7], width: 2, height: 1 },
    bounds: { west: -54.5, south: -15.4, east: -54.4, north: -15.3 },
  });
  assert.equal(meta.raster_available, true);
  assert.equal(meta.raster_format, 'internal_grid');
  assert.ok(meta.raster_bands.includes('ndvi'));
  assert.equal(meta.raster_url, null);
});

test('zone builder gera zona low_relative_vigor e remove ruído pequeno', () => {
  const values = [
    0.2, 0.2, 0.8, 0.8,
    0.2, 0.2, 0.8, 0.8,
    0.8, 0.8, 0.8, 0.8,
    0.8, 0.8, 0.8, 0.1,
  ];
  const result = buildNdviZones({
    values,
    width: 4,
    height: 4,
    bounds: { west: -54.5, south: -15.4, east: -54.49, north: -15.39 },
    percentiles: { p10: 0.2, p25: 0.25, p75: 0.8, p90: 0.8 },
    minAreaHa: 0.001,
  });
  assert.ok(result.zones.some((zone) => zone.type === 'very_low_relative_vigor'));
  assert.ok(result.spatialMetrics.zoneCount > 0);
  assert.ok(result.spatialMetrics.largestLowZoneHa > 0);
});
