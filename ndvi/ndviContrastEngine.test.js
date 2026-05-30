import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyContrastStretch,
  buildContrastMetadata,
  calculatePercentiles,
  colorBucketsForValues,
  renderAbsoluteNdviColor,
  renderAgronomicContrastColor,
} from './ndviContrastEngine.js';

const highUniform = Array.from({ length: 100 }, (_, i) => 0.74 + (i / 99) * 0.18);

describe('ndviContrastEngine', () => {
  it('NDVI 0.74-0.92 no modo absoluto fica majoritariamente verde', () => {
    const colors = highUniform.map((v) => renderAbsoluteNdviColor(v).join(','));
    const greenish = colors.filter((c) => !c.startsWith('0.843')).length;
    assert.ok(greenish / colors.length > 0.85);
  });

  it('NDVI 0.74-0.92 no modo contraste gera buckets diferentes', () => {
    const contrast = buildContrastMetadata(highUniform);
    const buckets = colorBucketsForValues(highUniform, contrast);
    assert.ok(Object.keys(buckets).length >= 5);
    assert.equal(contrast.lowContrastScene, false);
  });

  it('p5/p95 calculados corretamente', () => {
    const p = calculatePercentiles([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], [5, 50, 95]);
    assert.equal(p.p50, 0.45);
    assert.equal(p.p5, 0.045);
    assert.equal(p.p95, 0.855);
  });

  it('lowContrastScene true quando range muito baixo', () => {
    const contrast = buildContrastMetadata(Array.from({ length: 40 }, (_, i) => 0.86 + i * 0.0005));
    assert.equal(contrast.lowContrastScene, true);
    assert.equal(contrast.stretchMode, 'p2_p98');
  });

  it('preview contrast nao usa ndviMean como cor unica', () => {
    const contrast = buildContrastMetadata(highUniform);
    const low = applyContrastStretch(0.76, contrast.pLow, contrast.pHigh);
    const mid = applyContrastStretch(0.84, contrast.pLow, contrast.pHigh);
    const high = applyContrastStretch(0.92, contrast.pLow, contrast.pHigh);
    assert.notDeepEqual(renderAgronomicContrastColor(low), renderAgronomicContrastColor(mid));
    assert.notDeepEqual(renderAgronomicContrastColor(mid), renderAgronomicContrastColor(high));
  });
});
