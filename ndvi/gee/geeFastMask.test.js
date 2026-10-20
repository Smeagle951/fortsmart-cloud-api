import test from 'node:test';
import assert from 'node:assert/strict';
import { attachCloudScorePlus, buildNdviValidMask, prepareAnalysisImage } from './geeNdviEngine.js';

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
