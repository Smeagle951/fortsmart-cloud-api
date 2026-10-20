import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import {
  attachCloudScorePlus,
  attachPreviewColorBuckets,
  buildNdviValidMask,
  prepareAnalysisImage,
} from './geeNdviEngine.js';
import { ndviToPreviewRgb } from '../ndviColormap.js';

test('cena recente sem Cloud Score+ mantém máscara SCL sem selecionar imagem nula', () => {
  const selected = [];
  const cloudFallback = {
    rename: () => cloudFallback,
    select: (bands) => {
      selected.push(bands);
      return cloudFallback;
    },
  };
  const image = {
    get: () => 'recent-scene',
    addBands: (bands) => {
      assert.equal(bands, cloudFallback);
      return image;
    },
  };
  const gee = {
    Image: Object.assign((value) => value, {
      constant: () => cloudFallback,
    }),
    ImageCollection: () => ({ filter: () => ({ first: () => null }) }),
    Filter: { eq: () => ({}) },
    Algorithms: {
      If: (candidate, match, fallback) => {
        assert.equal(candidate, null);
        assert.equal(match, null);
        return fallback;
      },
    },
  };
  assert.equal(attachCloudScorePlus(gee, image), image);
  assert.deepEqual(selected, [['cs', 'cs_cdf']]);
});

test('máscara rápida usa SCL sem solicitar cs_cdf ausente', () => {
  const requested = [];
  const imageValue = {
    and: () => imageValue, mask: () => imageValue,
    gt: () => imageValue, gte: () => imageValue,
    lte: () => imageValue, neq: () => imageValue,
    updateMask: () => imageValue, clip: () => imageValue,
    selfMask: () => imageValue,
  };
  const image = {
    select: (band) => {
      requested.push(band);
      if (band === 'cs_cdf') throw new Error('cs_cdf ausente');
      return imageValue;
    },
  };
  const gee = { Image: { constant: () => imageValue } };
  const result = buildNdviValidMask(gee, {
    image, ndvi: imageValue, geometry: {}, fast: true,
  });
  assert.equal(result, imageValue);
  assert.ok(requested.includes('SCL'));
  assert.ok(!requested.includes('cs_cdf'));
});

test('preparo GEE converte copyProperties de Element para Image antes da máscara', () => {
  const image = {
    select: () => image,
    multiply: () => image,
    addBands: () => image,
    propertyNames: () => [],
    get: () => 'scene',
    copyProperties: () => ({ kind: 'element_without_image_methods' }),
    updateMask: () => image,
    neq: () => image,
    and: () => image,
    gte: () => image,
  };
  let casts = 0;
  const gee = {
    Image: Object.assign((value) => {
      if (value === image) return image;
      assert.equal(value.kind, 'element_without_image_methods');
      casts += 1;
      return image;
    }, { constant: () => ({ rename: () => image }) }),
    ImageCollection: () => ({
      filter: () => ({ first: () => image }),
    }),
    Filter: { eq: () => ({}) },
    Algorithms: { If: (_, match) => match },
  };

  assert.equal(prepareAnalysisImage(gee, image, { fast: true }), image);
  assert.equal(prepareAnalysisImage(gee, image), image);
  assert.equal(casts, 2);
});

test('preview GEE publica buckets relativos calculados da mesma imagem exibida', () => {
  const values = [0.12, 0.35, 0.5, 0.65, 0.8, 0.95];
  const png = new PNG({ width: values.length, height: 1 });
  values.forEach((value, index) => {
    const rgb = ndviToPreviewRgb(value, { mode: 'relative', vmin: 0, vmax: 1 });
    const offset = index * 4;
    png.data[offset] = Math.round(rgb[0] * 255);
    png.data[offset + 1] = Math.round(rgb[1] * 255);
    png.data[offset + 2] = Math.round(rgb[2] * 255);
    png.data[offset + 3] = 255;
  });
  const stats = { contrast: { p5: 0.02, p50: 0.14, p95: 0.24 } };

  attachPreviewColorBuckets(
    stats,
    PNG.sync.write(png),
    'ndvi_contrast',
  );

  const buckets = stats.contrast.colorBuckets;
  assert.ok(buckets);
  assert.equal(
    Object.values(buckets).reduce((sum, value) => sum + value, 0),
    100.2,
  );
  assert.deepEqual(stats.redPercent, buckets.redPercent);
  assert.ok(Object.values(buckets).every((value) => value > 0));
});
