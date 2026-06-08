/**
 * Paletas NDVI para preview Copernicus (pixel a pixel, B04/B08).
 * Nunca colorir por ndviMean — só por NDVI por pixel.
 */

/** @typedef {'absolute' | 'relative' | 'auto'} NdviColormapMode */

const AGRONOMIC_STOPS = [
  { max: 0.2, rgb: [0.843, 0.188, 0.153] }, // #d73027
  { max: 0.35, rgb: [0.988, 0.553, 0.349] }, // #fc8d59
  { max: 0.5, rgb: [0.996, 0.878, 0.545] }, // #fee08b
  { max: 0.65, rgb: [0.569, 0.812, 0.376] }, // #91cf60
  { max: 0.78, rgb: [0.369, 0.788, 0.384] },
  { max: 0.88, rgb: [0.204, 0.659, 0.325] },
  { max: 1.01, rgb: [0.102, 0.596, 0.314] }, // #1a9850
];

function colorFromNdviAbsolute(ndvi) {
  const v = Math.max(-1, Math.min(1, ndvi));
  for (const stop of AGRONOMIC_STOPS) {
    if (v < stop.max) return stop.rgb;
  }
  return AGRONOMIC_STOPS[AGRONOMIC_STOPS.length - 1].rgb;
}

function colorFromTRelative(t) {
  const stops = [
    { pos: 0.0, rgb: [0.608, 0.110, 0.110] }, // #9B1C1C
    { pos: 0.2, rgb: [0.839, 0.227, 0.184] }, // #D63A2F
    { pos: 0.4, rgb: [0.961, 0.620, 0.043] }, // #F59E0B
    { pos: 0.55, rgb: [0.992, 0.878, 0.278] }, // #FDE047
    { pos: 0.7, rgb: [0.639, 0.839, 0.361] }, // #A3D65C
    { pos: 0.85, rgb: [0.247, 0.639, 0.302] }, // #3FA34D
    { pos: 1.0, rgb: [0.043, 0.420, 0.208] }, // #0B6B35
  ];
  const x = Math.max(0, Math.min(1, t));
  if (x <= stops[0].pos) return stops[0].rgb;
  for (let i = 1; i < stops.length; i += 1) {
    const prev = stops[i - 1];
    const next = stops[i];
    if (x <= next.pos) {
      const span = Math.max(next.pos - prev.pos, 0.000001);
      const u = (x - prev.pos) / span;
      return [
        prev.rgb[0] + (next.rgb[0] - prev.rgb[0]) * u,
        prev.rgb[1] + (next.rgb[1] - prev.rgb[1]) * u,
        prev.rgb[2] + (next.rgb[2] - prev.rgb[2]) * u,
      ];
    }
  }
  return stops[stops.length - 1].rgb;
}

/**
 * Espelha a lógica do evalscript (para testes unitários).
 */
export function ndviToPreviewRgb(ndvi, { mode = 'absolute', vmin = 0, vmax = 1 } = {}) {
  if (!Number.isFinite(ndvi)) return null;
  if (mode === 'relative') {
    const span = Math.max(Number(vmax) - Number(vmin), 0.02);
    const t = (ndvi - Number(vmin)) / span;
    return colorFromTRelative(t);
  }
  return colorFromNdviAbsolute(ndvi);
}

export function pickPreviewColormapMode(stats, requested = 'auto') {
  const mode = String(requested || 'auto').toLowerCase();
  if (mode === 'absolute' || mode === 'relative') return mode;
  const min = Number(stats?.ndvi_min);
  const max = Number(stats?.ndvi_max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 'absolute';
  const span = max - min;
  // Talhão homogéneo alto: stretch relativo destaca zonas fracas.
  if (span < 0.12 && max > 0.55) return 'relative';
  return 'absolute';
}

export function buildAbsoluteColorEvalscript() {
  const stopsJson = JSON.stringify(
    AGRONOMIC_STOPS.map((s) => ({ m: s.max, r: s.rgb[0], g: s.rgb[1], b: s.rgb[2] })),
  );
  return `//VERSION=3
const STOPS = ${stopsJson};
function setup() {
  return { input: ["B04", "B08", "dataMask"], output: { bands: 4, sampleType: 'AUTO' } };
}
function colorAbs(ndvi) {
  const v = Math.max(-1, Math.min(1, ndvi));
  for (let i = 0; i < STOPS.length; i++) {
    if (v < STOPS[i].m) return [STOPS[i].r, STOPS[i].g, STOPS[i].b, 1];
  }
  const s = STOPS[STOPS.length - 1];
  return [s.r, s.g, s.b, 1];
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0, 0, 0, 0];
  const ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
  if (!isFinite(ndvi)) return [0, 0, 0, 0];
  return colorAbs(ndvi);
}`;
}

export function buildRelativeColorEvalscript(vmin, vmax) {
  const vMin = Number(vmin);
  const vMax = Number(vmax);
  const safeMin = Number.isFinite(vMin) ? vMin : 0;
  const safeMax = Number.isFinite(vMax) ? vMax : 1;
  const span = Math.max(safeMax - safeMin, 0.02);
  return `//VERSION=3
const VMIN = ${safeMin};
const SPAN = ${span};
const STOPS = [
  {m:0.15,r:0.843,g:0.188,b:0.153},
  {m:0.30,r:0.988,g:0.553,b:0.349},
  {m:0.45,r:0.996,g:0.878,b:0.545},
  {m:0.60,r:0.569,g:0.812,b:0.376},
  {m:0.80,r:0.369,g:0.788,b:0.384},
  {m:1.01,r:0.102,g:0.596,b:0.314}
];
function setup() {
  return { input: ["B04", "B08", "dataMask"], output: { bands: 4, sampleType: 'AUTO' } };
}
function colorRel(t) {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 0; i < STOPS.length; i++) {
    if (x < STOPS[i].m) return [STOPS[i].r, STOPS[i].g, STOPS[i].b, 1];
  }
  const s = STOPS[STOPS.length - 1];
  return [s.r, s.g, s.b, 1];
}
function evaluatePixel(sample) {
  if (sample.dataMask === 0) return [0, 0, 0, 0];
  const ndvi = (sample.B08 - sample.B04) / (sample.B08 + sample.B04);
  if (!isFinite(ndvi)) return [0, 0, 0, 0];
  const t = (ndvi - VMIN) / SPAN;
  return colorRel(t);
}`;
}

export function logColormapDiagnostics({ sceneId, stats, colormapMode }) {
  const mean = stats?.ndvi_mean;
  const min = stats?.ndvi_min;
  const max = stats?.ndvi_max;
  let stdApprox = '-';
  if (Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(mean)) {
    stdApprox = Number(((max - min) / 4).toFixed(3));
  }
  console.log(
    `ℹ️ [NDVI][Colormap] sceneId=${sceneId} mode=${colormapMode} ` +
      `ndviMean=${mean ?? '-'} ndviMin=${min ?? '-'} ndviMax=${max ?? '-'} ` +
      `ndviStdApprox=${stdApprox} span=${Number.isFinite(min) && Number.isFinite(max) ? (max - min).toFixed(3) : '-'} ` +
      `veryLow=${stats?.very_low_percent ?? '-'}% low=${stats?.low_percent ?? '-'}% ` +
      `medium=${stats?.medium_percent ?? '-'}% high=${stats?.high_percent ?? '-'}%`,
  );
}
