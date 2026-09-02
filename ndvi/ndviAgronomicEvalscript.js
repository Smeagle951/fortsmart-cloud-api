/**
 * Evalscripts Copernicus Process API — multibandas agronômicas.
 */

/** Pacote completo — só para NDRE/NDMI/BSI/cobertura (não usar no NDVI V1). */
const INPUT_BANDS_FULL =
  '["B02","B03","B04","B05","B06","B07","B08","B8A","B11","B12","SCL","dataMask"]';

/** NDVI V1: apenas o necessário para (B8−B4)/(B8+B4) + máscara. */
const INPUT_BANDS_NDVI_ONLY = '["B04","B08","SCL","dataMask"]';

const NDVI_ONLY_HELPERS = `
function normalizeReflectance(v){if(!isFinite(v))return NaN;return v>2?v/10000:v;}
function safeDiv(a,b){return Math.abs(b)<0.000001?NaN:a/b;}
function ndvi(s){const n=normalizeReflectance(s.B08);const r=normalizeReflectance(s.B04);const v=safeDiv(n-r,n+r);return v>=-1&&v<=1?v:NaN;}
function isWaterCloud(scl){return [0,1,3,6,8,9,10,11].indexOf(scl)>=0;}
function classifyNdviOnly(sample){
  if(sample.dataMask===0) return 0;
  if(isWaterCloud(sample.SCL)) return 1;
  const n=ndvi(sample);
  if(!isFinite(n)) return 0;
  if(n<0.15) return 2;
  if(n<0.35) return 4;
  if(n<0.55) return 5;
  if(n<0.75) return 6;
  return 7;
}
`;

const INDEX_HELPERS = `
function normalizeReflectance(v){if(!isFinite(v))return NaN;return v>2?v/10000:v;}
function safeDiv(a,b){return Math.abs(b)<0.000001?NaN:a/b;}
function ndvi(s){const n=normalizeReflectance(s.B08);const r=normalizeReflectance(s.B04);const v=safeDiv(n-r,n+r);return v>=-1&&v<=1?v:NaN;}
function ndre(s){const re=normalizeReflectance(s.B05);if(!isFinite(re)||re<0.001)return NaN;const n=normalizeReflectance(isFinite(s.B8A)&&s.B8A>0?s.B8A:s.B08);const v=safeDiv(n-re,n+re);return v>=-1&&v<=1?v:NaN;}
function savi(s){const n=normalizeReflectance(s.B08);const r=normalizeReflectance(s.B04);return safeDiv(n-r,n+r+0.5)*1.5;}
function bsi(s){const sw=normalizeReflectance(s.B11);const r=normalizeReflectance(s.B04);const n=normalizeReflectance(s.B08);const b=normalizeReflectance(s.B02);return safeDiv((sw+r)-(n+b),(sw+r)+(n+b));}
function ndmi(s){const n=normalizeReflectance(s.B08);const sw=normalizeReflectance(s.B11);const v=safeDiv(n-sw,n+sw);return v>=-1&&v<=1?v:NaN;}
function nbr2(s){const a=normalizeReflectance(s.B11);const b=normalizeReflectance(s.B12);if(!isFinite(a)||!isFinite(b)||b<0.001)return NaN;return safeDiv(a-b,a+b);}
function isWaterCloud(scl){
  return [0,1,3,6,8,9,10,11].indexOf(scl)>=0;
}
function classify(sample){
  if(sample.dataMask===0) return 0;
  const scl=sample.SCL;
  const n=ndvi(sample);
  const r=ndre(sample);
  const b=bsi(sample);
  const m=ndmi(sample);
  const nb=nbr2(sample);
  if(!isFinite(n)) return 0;
  if(isWaterCloud(scl)) return 1;
  if(isFinite(b)&&n<0.25&&b>0.18) return 2;
  if(isFinite(nb)&&n>=0.08&&n<0.40&&(!isFinite(r)||r<0.15)&&isFinite(b)&&b>0.02&&b<0.35&&nb>0.02) return 3;
  if(isFinite(r)&&n>=0.35&&r>=0.18){
    if(n<0.45) return 4;
    if(n<0.65) return 5;
    if(n<=0.8) return 6;
    return 7;
  }
  if(isFinite(r)&&n>=0.35&&r<0.18&&(!isFinite(m)||m<0.15)) return 8;
  return 0;
}
function colorForClass(cid){
  if(cid===1) return [0,0,0,0];
  if(cid===2) return [0.82,0.71,0.55,1];
  if(cid===3) return [0.90,0.82,0.62,1];
  if(cid===4) return [0.84,0.19,0.15,1];
  if(cid===5) return [0.98,0.85,0.35,1];
  if(cid===6) return [0.55,0.82,0.40,1];
  if(cid===7) return [0.12,0.50,0.22,1];
  if(cid===8) return [0.55,0.15,0.45,1];
  return [0,0,0,0];
}
`;

/** NDVI V1 — PNG stats com B04+B08+SCL apenas. R=NDVI, G=classe simples, B=0. */
export function buildNdviOnlyPackedStatsEvalscript() {
  return `//VERSION=3
${NDVI_ONLY_HELPERS}
function setup(){
  return {input:${INPUT_BANDS_NDVI_ONLY},output:{bands:4,sampleType:'AUTO'}};
}
function evaluatePixel(sample){
  if(sample.dataMask===0) return [0,0,0,0];
  const n=ndvi(sample);
  if(!isFinite(n)) return [0,0,0,0];
  const cid=classifyNdviOnly(sample);
  if(cid===0 || cid===1) return [0,0,0,0];
  const r=(Math.max(-1,Math.min(1,n))+1)/2;
  const g=cid/8;
  return [r,g,0,1];
}`;
}

export function isNdviOnlyVisualMode(mode) {
  const m = String(mode || '').toLowerCase();
  return (
    m === 'ndvi_contrast' ||
    m === 'ndvi_absolute' ||
    m === 'ndvi_relative' ||
    m === 'agronomic_classes'
  );
}

/** PNG stats: R=NDVI, G=classe, B=NDRE (pacote completo — legado/avançado). */
export function buildAgronomicPackedStatsEvalscript() {
  return `//VERSION=3
${INDEX_HELPERS}
function setup(){
  return {input:${INPUT_BANDS_FULL},output:{bands:4,sampleType:'AUTO'}};
}
function evaluatePixel(sample){
  if(sample.dataMask===0) return [0,0,0,0];
  const n=ndvi(sample);
  if(!isFinite(n)) return [0,0,0,0];
  const cid=classify(sample);
  if(cid===0 || cid===1) return [0,0,0,0];
  const r=(Math.max(-1,Math.min(1,n))+1)/2;
  const g=cid/8;
  const re=ndre(sample);
  const b=(Math.max(-1,Math.min(1,isFinite(re)?re:0))+1)/2;
  return [r,g,b,1];
}`;
}

/** PNG índices: R=SAVI, G=BSI, B=NDMI */
export function buildIndicesPackedStatsEvalscript() {
  return `//VERSION=3
${INDEX_HELPERS}
function setup(){
  return {input:${INPUT_BANDS_FULL},output:{bands:4,sampleType:'AUTO'}};
}
function evaluatePixel(sample){
  if(sample.dataMask===0) return [0,0,0,0];
  const cid=classify(sample);
  if(cid===0 || cid===1) return [0,0,0,0];
  const sv=savi(sample);
  const b=bsi(sample);
  const m=ndmi(sample);
  const r=(Math.max(-1,Math.min(1,isFinite(sv)?sv:0))+1)/2;
  const g=(Math.max(-1,Math.min(1,isFinite(b)?b:0))+1)/2;
  const bl=(Math.max(-1,Math.min(1,isFinite(m)?m:0))+1)/2;
  return [r,g,bl,1];
}`;
}

export function buildAgronomicClassesPreviewEvalscript() {
  return `//VERSION=3
${INDEX_HELPERS}
function setup(){
  return {input:${INPUT_BANDS_FULL},output:{bands:4,sampleType:'AUTO'}};
}
function evaluatePixel(sample){
  if(sample.dataMask===0) return [0,0,0,0];
  const cid=classify(sample);
  if(cid===0) return [0,0,0,0];
  return colorForClass(cid);
}`;
}

export function buildNdviAbsolutePreviewEvalscript() {
  const stops = [
    { m: 0.2, r: 0.843, g: 0.188, b: 0.153 },
    { m: 0.35, r: 0.988, g: 0.553, b: 0.349 },
    { m: 0.5, r: 0.996, g: 0.878, b: 0.545 },
    { m: 0.65, r: 0.569, g: 0.812, b: 0.376 },
    { m: 0.78, r: 0.369, g: 0.788, b: 0.384 },
    { m: 0.88, r: 0.204, g: 0.659, b: 0.325 },
    { m: 1.01, r: 0.102, g: 0.596, b: 0.314 },
  ];
  return `//VERSION=3
const STOPS=${JSON.stringify(stops)};
function setup(){return {input:["B04","B08","SCL","dataMask"],output:{bands:4,sampleType:'AUTO'}};}
function isWaterCloud(scl){return [0,1,3,6,8,9,10,11].indexOf(scl)>=0;}
${INDEX_HELPERS}
function colorAbs(v){
  for(let i=0;i<STOPS.length;i++){if(v<STOPS[i].m)return [STOPS[i].r,STOPS[i].g,STOPS[i].b,1];}
  const s=STOPS[STOPS.length-1];return [s.r,s.g,s.b,1];
}
function evaluatePixel(s){
  if(s.dataMask===0||isWaterCloud(s.SCL)) return [0,0,0,0];
  const n=ndvi(s);
  if(!isFinite(n)) return [0,0,0,0];
  return colorAbs(Math.max(-1,Math.min(1,n)));
}`;
}

export function buildNdviRelativePreviewEvalscript(vmin, vmax) {
  const vMin = Number.isFinite(Number(vmin)) ? Number(vmin) : 0;
  const span = Math.max((Number(vmax) || 1) - vMin, 0.02);
  const stops = [
    { m: 0.15, r: 0.843, g: 0.188, b: 0.153 },
    { m: 0.3, r: 0.988, g: 0.553, b: 0.349 },
    { m: 0.45, r: 0.996, g: 0.878, b: 0.545 },
    { m: 0.6, r: 0.569, g: 0.812, b: 0.376 },
    { m: 0.8, r: 0.369, g: 0.788, b: 0.384 },
    { m: 1.01, r: 0.102, g: 0.596, b: 0.314 },
  ];
  return `//VERSION=3
const VMIN=${vMin};
const SPAN=${span};
const STOPS=${JSON.stringify(stops)};
function setup(){return {input:["B04","B08","SCL","dataMask"],output:{bands:4,sampleType:'AUTO'}};}
function isWaterCloud(scl){return [0,1,3,6,8,9,10,11].indexOf(scl)>=0;}
${INDEX_HELPERS}
function colorRel(t){
  const x=Math.max(0,Math.min(1,t));
  for(let i=0;i<STOPS.length;i++){if(x<STOPS[i].m)return [STOPS[i].r,STOPS[i].g,STOPS[i].b,1];}
  const s=STOPS[STOPS.length-1];return [s.r,s.g,s.b,1];
}
function evaluatePixel(s){
  if(s.dataMask===0||isWaterCloud(s.SCL)) return [0,0,0,0];
  const n=ndvi(s);
  if(!isFinite(n)) return [0,0,0,0];
  return colorRel((n-VMIN)/SPAN);
}`;
}

function buildIndexPreview(evalExpr, stops, { normalize = 'absolute' } = {}) {
  const useUnitInterval = normalize === 'unit';
  return `//VERSION=3
const STOPS=${JSON.stringify(stops)};
function setup(){return {input:${INPUT_BANDS_FULL},output:{bands:4,sampleType:'AUTO'}};}
function isWaterCloud(scl){return [0,1,3,6,8,9,10,11].indexOf(scl)>=0;}
function colorT(t){
  const x=Math.max(0,Math.min(1,t));
  for(let i=0;i<STOPS.length;i++){if(x<STOPS[i].m)return [STOPS[i].r,STOPS[i].g,STOPS[i].b,1];}
  const s=STOPS[STOPS.length-1];return [s.r,s.g,s.b,1];
}
function colorAbs(v){
  const x=Math.max(-1,Math.min(1,v));
  for(let i=0;i<STOPS.length;i++){if(x<STOPS[i].m)return [STOPS[i].r,STOPS[i].g,STOPS[i].b,1];}
  const s=STOPS[STOPS.length-1];return [s.r,s.g,s.b,1];
}
${INDEX_HELPERS}
function evaluatePixel(s){
  if(s.dataMask===0||isWaterCloud(s.SCL)) return [0,0,0,0];
  const v=${evalExpr};
  if(!isFinite(v)) return [0,0,0,0];
  ${useUnitInterval ? 'return colorT((v+1)/2);' : 'return colorAbs(v);'}
}`;
}

export function buildNdviContrastPreviewEvalscript(stats = {}) {
  const p5 = Number(stats.ndvi_p5 ?? stats.ndviP5);
  const p95 = Number(stats.ndvi_p95 ?? stats.ndviP95);
  const p2 = Number(stats.ndvi_p2 ?? stats.ndviP2);
  const p98 = Number(stats.ndvi_p98 ?? stats.ndviP98);
  const robustRange = Number.isFinite(p5) && Number.isFinite(p95) ? p95 - p5 : null;
  const lowContrastScene = Number.isFinite(robustRange) && robustRange < 0.05;
  const useP2P98 =
    !lowContrastScene &&
    (!Number.isFinite(p5) || !Number.isFinite(p95) || p95 - p5 < 0.08);
  const low = useP2P98 && Number.isFinite(p2) ? p2 : p5;
  const high = useP2P98 && Number.isFinite(p98) ? p98 : p95;
  const safeLow = Number.isFinite(low) ? low : 0;
  const safeHigh = Number.isFinite(high) ? high : 1;
  const span = Math.max(safeHigh - safeLow, 0.02);
  const gamma = Number.isFinite(Number(stats.contrast?.gamma ?? stats.gamma))
    ? Number(stats.contrast?.gamma ?? stats.gamma)
    : 0.92;
  const stops = [
    { m: 0.0, r: 0.478, g: 0.0, b: 0.0 },
    { m: 0.1, r: 0.718, g: 0.11, b: 0.11 },
    { m: 0.2, r: 0.898, g: 0.224, b: 0.208 },
    { m: 0.3, r: 0.984, g: 0.549, b: 0.0 },
    { m: 0.4, r: 0.992, g: 0.847, b: 0.208 },
    { m: 0.5, r: 0.831, g: 0.882, b: 0.341 },
    { m: 0.6, r: 0.612, g: 0.8, b: 0.396 },
    { m: 0.7, r: 0.4, g: 0.733, b: 0.416 },
    { m: 0.8, r: 0.18, g: 0.49, b: 0.196 },
    { m: 0.9, r: 0.106, g: 0.369, b: 0.125 },
    { m: 1.01, r: 0.0, g: 0.231, b: 0.122 },
  ];
  return `//VERSION=3
const VLOW=${safeLow};
const SPAN=${span};
const GAMMA=${gamma};
const LOW_CONTRAST=${lowContrastScene ? 'true' : 'false'};
const STOPS=${JSON.stringify(stops)};
const ABS_STOPS=[
  {m:0.2,r:0.843,g:0.188,b:0.153},
  {m:0.35,r:0.988,g:0.553,b:0.349},
  {m:0.5,r:0.996,g:0.878,b:0.545},
  {m:0.65,r:0.569,g:0.812,b:0.376},
  {m:0.78,r:0.369,g:0.788,b:0.384},
  {m:0.88,r:0.204,g:0.659,b:0.325},
  {m:1.01,r:0.102,g:0.596,b:0.314}
];
function setup(){return {input:["B04","B08","SCL","dataMask"],output:{bands:4,sampleType:'AUTO'}};}
function isWaterCloud(scl){return [0,1,3,6,8,9,10,11].indexOf(scl)>=0;}
${INDEX_HELPERS}
function colorAbs(v){
  const x=Math.max(-1,Math.min(1,v));
  for(let i=0;i<ABS_STOPS.length;i++){if(x<ABS_STOPS[i].m)return [ABS_STOPS[i].r,ABS_STOPS[i].g,ABS_STOPS[i].b,1];}
  const s=ABS_STOPS[ABS_STOPS.length-1];return [s.r,s.g,s.b,1];
}
function colorContrast(t){
  const x=Math.pow(Math.max(0,Math.min(1,t)),GAMMA);
  if(x<=0){const s=STOPS[0];return [s.r,s.g,s.b,1];}
  for(let i=1;i<STOPS.length;i++){
    if(x<=STOPS[i].m){
      const a=STOPS[i-1]; const b=STOPS[i];
      const span=Math.max(b.m-a.m,0.000001);
      const u=(x-a.m)/span;
      return [a.r+(b.r-a.r)*u,a.g+(b.g-a.g)*u,a.b+(b.b-a.b)*u,1];
    }
  }
  const s=STOPS[STOPS.length-1];return [s.r,s.g,s.b,1];
}
function evaluatePixel(s){
  if(s.dataMask===0||isWaterCloud(s.SCL)) return [0,0,0,0];
  const n=ndvi(s);
  if(!isFinite(n)) return [0,0,0,0];
  if(LOW_CONTRAST) return colorAbs(n);
  return colorContrast((n-VLOW)/SPAN);
}`;
}

export function buildNdrePreviewEvalscript() {
  // Limiares absolutos alinhados à legenda (Baixo <0.20, Médio <0.35, Alto ≥0.35).
  return buildIndexPreview('ndre(s)', [
    { m: 0.2, r: 0.843, g: 0.188, b: 0.153 },
    { m: 0.35, r: 0.992, g: 0.847, b: 0.208 },
    { m: 0.5, r: 0.651, g: 0.851, b: 0.416 },
    { m: 1.01, r: 0.106, g: 0.62, b: 0.467 },
  ], { normalize: 'absolute' });
}

export function buildSaviPreviewEvalscript() {
  return buildIndexPreview('savi(s)', [
    { m: 0.25, r: 0.84, g: 0.19, b: 0.15 },
    { m: 0.55, r: 0.98, g: 0.85, b: 0.35 },
    { m: 1.01, r: 0.12, g: 0.5, b: 0.22 },
  ], { normalize: 'absolute' });
}

export function buildBsiSoilPreviewEvalscript() {
  return buildIndexPreview('bsi(s)', [
    { m: 0.05, r: 0.263, g: 0.627, b: 0.278 },
    { m: 0.2, r: 0.976, g: 0.659, b: 0.145 },
    { m: 1.01, r: 0.82, g: 0.71, b: 0.55 },
  ], { normalize: 'absolute' });
}

export function buildNdmiWaterStressPreviewEvalscript() {
  return buildIndexPreview('ndmi(s)', [
    { m: 0.2, r: 0.749, g: 0.212, b: 0.047 },
    { m: 0.4, r: 0.259, g: 0.647, b: 0.961 },
    { m: 1.01, r: 0.082, g: 0.396, b: 0.753 },
  ], { normalize: 'absolute' });
}

/** @param {string} visualMode */
export function buildPreviewEvalscript(visualMode, stats = {}) {
  const mode = String(visualMode || 'ndvi_contrast').toLowerCase();
  switch (mode) {
    case 'ndvi_contrast':
      return buildNdviContrastPreviewEvalscript(stats);
    case 'ndvi_absolute':
      return buildNdviAbsolutePreviewEvalscript();
    case 'ndvi_relative':
      return buildNdviRelativePreviewEvalscript(stats.ndvi_min, stats.ndvi_max);
    case 'ndre':
      return buildNdrePreviewEvalscript();
    case 'savi':
      return buildSaviPreviewEvalscript();
    case 'bsi_soil':
      return buildBsiSoilPreviewEvalscript();
    case 'ndmi_water_stress':
      return buildNdmiWaterStressPreviewEvalscript();
    case 'agronomic_classes':
    default:
      return buildAgronomicClassesPreviewEvalscript();
  }
}

export const VISUAL_MODES = [
  'ndvi_absolute',
  'ndvi_contrast',
  'ndvi_relative',
  'agronomic_classes',
  'ndre',
  'savi',
  'bsi_soil',
  'ndmi_water_stress',
  'post_harvest_cover',
];
