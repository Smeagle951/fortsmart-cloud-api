import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNdviValidMask } from './geeNdviEngine.js';

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
