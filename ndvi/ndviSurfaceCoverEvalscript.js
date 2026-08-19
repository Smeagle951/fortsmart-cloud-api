/**
 * Evalscripts Copernicus — classificação categórica de superfície (não NDVI).
 */

const INPUT_BANDS =
  '["B02","B04","B05","B08","B8A","B11","B12","SCL","dataMask"]';

const SURFACE_HELPERS = `
function normalizeReflectance(v){if(!isFinite(v))return NaN;return v>2?v/10000:v;}
function safeDiv(a,b){return Math.abs(b)<0.000001?NaN:a/b;}
function ndvi(s){const n=normalizeReflectance(s.B08);const r=normalizeReflectance(s.B04);const v=safeDiv(n-r,n+r);return v>=-1&&v<=1?v:NaN;}
function ndre(s){const re=normalizeReflectance(s.B05);if(!isFinite(re)||re<0.001)return NaN;const n=normalizeReflectance(isFinite(s.B8A)&&s.B8A>0?s.B8A:s.B08);const v=safeDiv(n-re,n+re);return v>=-1&&v<=1?v:NaN;}
function savi(s){const n=normalizeReflectance(s.B08);const r=normalizeReflectance(s.B04);return safeDiv(n-r,n+r+0.5)*1.5;}
function bsi(s){const sw=normalizeReflectance(s.B11);const r=normalizeReflectance(s.B04);const n=normalizeReflectance(s.B08);const b=normalizeReflectance(s.B02);return safeDiv((sw+r)-(n+b),(sw+r)+(n+b));}
function ndmi(s){const n=normalizeReflectance(s.B08);const sw=normalizeReflectance(s.B11);const v=safeDiv(n-sw,n+sw);return v>=-1&&v<=1?v:NaN;}
function nbr2(s){const a=normalizeReflectance(s.B11);const b=normalizeReflectance(s.B12);if(!isFinite(a)||!isFinite(b)||b<0.001)return NaN;return safeDiv(a-b,a+b);}
function isMaskedScl(scl){return [0,1,2,3,8,9,10,11].indexOf(scl)>=0;}
function classifySurface(sample){
  if(sample.dataMask===0) return [7,0];
  const scl=sample.SCL;
  if(isMaskedScl(scl)) return [7,0];
  if(scl===6) return [6,0.80];
  const n=ndvi(sample);
  const r=ndre(sample);
  const b=bsi(sample);
  const m=ndmi(sample);
  const sv=savi(sample);
  const nb=nbr2(sample);
  if(!isFinite(n)) return [0,0.30];
  if(isFinite(b)&&n<0.22&&b>0.18){
    if(isFinite(m)&&m>=0.05) return [5,0.70];
    return [4,0.78];
  }
  if(isFinite(nb)&&n>=0.11&&n<=0.32&&(!isFinite(r)||r<=0.15)&&(!isFinite(b)||b<=0.15)&&nb>0.02) return [2,0.65];
  if(isFinite(m)&&n<=0.30&&m>=0.05&&(!isFinite(b)||b<0.10)) return [0,0.58];
  if(n>=0.35&&isFinite(r)&&r>=0.20) return [1,0.82];
  return [0,0.40];
}
function colorForSurface(cid){
  if(cid===1) return [0.18,0.49,0.20,1];
  if(cid===2) return [0.78,0.66,0.42,1];
  if(cid===3) return [0.54,0.48,0.33,1];
  if(cid===4) return [0.71,0.42,0.23,1];
  if(cid===5) return [0.44,0.38,0.34,1];
  if(cid===6) return [0.18,0.47,0.72,1];
  if(cid===0) return [0.86,0.86,0.86,1];
  return [0,0,0,0];
}
`;

export function buildSurfaceCoverPackedEvalscript() {
  return `//VERSION=3
${SURFACE_HELPERS}
function setup(){
  return {input:${INPUT_BANDS},output:{bands:4,sampleType:'AUTO'}};
}
function evaluatePixel(sample){
  const cls=classifySurface(sample);
  const cid=cls[0];
  const conf=cls[1];
  if(cid===7) return [0,0,0,0];
  return [cid/7, conf, 0, 1];
}`;
}

export function buildSurfaceCoverPreviewEvalscript() {
  return `//VERSION=3
${SURFACE_HELPERS}
function setup(){
  return {input:${INPUT_BANDS},output:{bands:4,sampleType:'AUTO'}};
}
function evaluatePixel(sample){
  const cls=classifySurface(sample);
  return colorForSurface(cls[0]);
}`;
}
