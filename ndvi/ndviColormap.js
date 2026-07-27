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

/** Limiares absolutos NDRE alinhados às classes Baixo/Médio/Alto. */
const NDRE_STOPS = [
  { max: 0.2, rgb: [0.776, 0.157, 0.157] }, // #C62828 baixo
  { max: 0.35, rgb: [0.992, 0.847, 0.208] }, // #FDD835 médio
  { max: 1.01, rgb: [0.180, 0.490, 0.196] }, // #2E7D32 alto
];

/** Limiares NDMI alinhados à legenda Seco / Adequado / Úmido. */
const NDMI_STOPS = [
  { max: 0.2, rgb: [0.749, 0.212, 0.047] }, // seco
  { max: 0.4, rgb: [0.259, 0.647, 0.961] }, // adequado
  { max: 1.01, rgb: [0.082, 0.396, 0.753] }, // úmido
];

const CONTRAST_LEGEND_REFS = [
  { key: 'redPercent', t: 0.12 },
  { key: 'orangePercent', t: 0.35 },
  { key: 'yellowPercent', t: 0.5 },
  { key: 'lightGreenPercent', t: 0.65 },
  { key: 'greenPercent', t: 0.8 },
  { key: 'darkGreenPercent', t: 0.95 },
];

/** Solo/cobertura: classes por BSI (fallback Copernicus); GEE usa SURFACE_CLASS. */
const BSI_STOPS = [
  { max: 0.05, rgb: [0.180, 0.490, 0.196] }, // vegetação #2E7D32
  { max: 0.15, rgb: [0.784, 0.663, 0.420] }, // palhada #C8A96B
  { max: 1.01, rgb: [0.710, 0.416, 0.227] }, // solo #B56A3A
];

function colorFromStops(value, stops) {
  const v = Math.max(-1, Math.min(1, value));
  for (const stop of stops) {
    if (v < stop.max) return stop.rgb;
  }
  return stops[stops.length - 1].rgb;
}

function colorFromNdviAbsolute(ndvi) {
  return colorFromStops(ndvi, AGRONOMIC_STOPS);
}

/**
 * Colormap absoluto por modo visual — evita stretch relativo que pinta
 * NDRE baixo (~0,17) de verde chapado.
 */
export function indexToAbsoluteRgb(value, visualMode = 'ndvi_absolute') {
  if (!Number.isFinite(value)) return null;
  const mode = String(visualMode || 'ndvi_absolute');
  if (mode === 'ndre') return colorFromStops(value, NDRE_STOPS);
  if (mode === 'ndmi_water_stress') return colorFromStops(value, NDMI_STOPS);
  if (mode === 'bsi_soil') return colorFromStops(value, BSI_STOPS);
  return colorFromNdviAbsolute(value);
}

export function isAbsoluteIndexVisualMode(visualMode) {
  const mode = String(visualMode || '');
  return mode === 'ndre'
    || mode === 'ndmi_water_stress'
    || mode === 'bsi_soil'
    || mode === 'ndvi_absolute'
    || mode === 'savi';
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
export function ndviToPreviewRgb(
  ndvi,
  {
    mode = 'absolute',
    vmin = 0,
    vmax = 1,
    visualMode = null,
  } = {},
) {
  if (!Number.isFinite(ndvi)) return null;
  if (visualMode && isAbsoluteIndexVisualMode(visualMode) && mode !== 'relative') {
    return indexToAbsoluteRgb(ndvi, visualMode);
  }
  if (mode === 'relative') {
    const span = Math.max(Number(vmax) - Number(vmin), 0.02);
    const t = (ndvi - Number(vmin)) / span;
    return colorFromTRelative(t);
  }
  return colorFromNdviAbsolute(ndvi);
}

/**
 * Classifica pixels RGBA opacos na legenda de contraste (6 buckets).
 * Use após o PNG mascarado — fonte da verdade visual da legenda.
 */
export function colorBucketsFromRgbaPixels(data, { minAlpha = 16 } = {}) {
  if (!data || data.length < 4) return null;
  const refs = CONTRAST_LEGEND_REFS.map((item) => ({
    key: item.key,
    rgb: colorFromTRelative(item.t).map((c) => Math.round(c * 255)),
  }));
  const out = {
    redPercent: 0,
    orangePercent: 0,
    yellowPercent: 0,
    lightGreenPercent: 0,
    greenPercent: 0,
    darkGreenPercent: 0,
  };
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < minAlpha) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    let bestKey = 'redPercent';
    let bestDist = Number.POSITIVE_INFINITY;
    for (const ref of refs) {
      const dr = r - ref.rgb[0];
      const dg = g - ref.rgb[1];
      const db = b - ref.rgb[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestKey = ref.key;
      }
    }
    out[bestKey] += 1;
    total += 1;
  }
  if (!total) return null;
  for (const key of Object.keys(out)) {
    out[key] = Number(((out[key] / total) * 100).toFixed(1));
  }
  return out;
}

export function moisturePercentsFromValues(values) {
  const valid = Array.isArray(values)
    ? values.map(Number).filter((v) => Number.isFinite(v) && v > -9000)
    : [];
  if (!valid.length) {
    return {
      waterStressPercent: null,
      adequateMoisturePercent: null,
      highMoisturePercent: null,
    };
  }
  let dry = 0;
  let adequate = 0;
  let wet = 0;
  for (const v of valid) {
    if (v < 0.2) dry += 1;
    else if (v < 0.4) adequate += 1;
    else wet += 1;
  }
  const pct = (n) => Number(((n / valid.length) * 100).toFixed(1));
  return {
    waterStressPercent: pct(dry),
    adequateMoisturePercent: pct(adequate),
    highMoisturePercent: pct(wet),
  };
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
