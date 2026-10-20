import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNdviValidMask, prepareAnalysisImage } from './geeNdviEngine.js';

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
    Image: (value) => {
      assert.equal(value.kind, 'element_without_image_methods');
      casts += 1;
      return image;
    },
    ImageCollection: () => ({
      filter: () => ({ first: () => image }),
    }),
    Filter: { eq: () => ({}) },
  };

  assert.equal(prepareAnalysisImage(gee, image, { fast: true }), image);
  assert.equal(prepareAnalysisImage(gee, image), image);
  assert.equal(casts, 2);
});
