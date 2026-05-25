#!/usr/bin/env node
/**
 * Valida GET /windows/planting-map/:farmId
 *
 * Uso:
 *   FORTSMART_API_KEY=xxx FARM_CLOUD_ID=uuid node scripts/validate-planting-map.mjs
 *   FORTSMART_API_BASE=https://api.fortsmart-agro.com.br (opcional)
 */

const base = (process.env.FORTSMART_API_BASE || 'https://api.fortsmart-agro.com.br').replace(/\/$/, '');
const apiKey = process.env.FORTSMART_API_KEY?.trim();
const farmId = process.env.FARM_CLOUD_ID?.trim();

const REQUIRED_PROPS = [
  'talhao_nome',
  'cultura',
  'data_plantio',
];

const ENRICHED_PROPS = [
  'material',
  'variedade',
  'hibrido',
  'dae',
  'dap',
  'estande_inicial',
  'estande_atual',
  'populacao_planejada',
  'populacao_final',
  'cv',
  'estadio_fenologico',
  'observacoes',
];

const PLANTABILITY_PROPS = [
  'falhas',
  'duplas',
  'falhas_percentual',
  'duplas_percentual',
  'aceitaveis_percentual',
  'perda_estande',
  'velocidade',
];

if (!apiKey || !farmId) {
  console.error('Defina FORTSMART_API_KEY e FARM_CLOUD_ID');
  process.exit(1);
}

const url = `${base}/windows/planting-map/${encodeURIComponent(farmId)}`;

const res = await fetch(url, {
  headers: { 'x-api-key': apiKey, Accept: 'application/json' },
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  console.error('Resposta não é JSON:', text.slice(0, 500));
  process.exit(1);
}

if (!res.ok) {
  console.error(`HTTP ${res.status}`, body);
  process.exit(1);
}

const data = body.data ?? body;
const features = Array.isArray(data.geo_features) ? data.geo_features : [];
const plots = Array.isArray(data.plots) ? data.plots : [];
const subareas = Array.isArray(data.subareas) ? data.subareas : [];
const summary = data.summary ?? {};

console.log('\n=== Planting Map Cloud — validação ===\n');
console.log(`URL: ${url}`);
console.log(`HTTP: ${res.status}`);
console.log(`farm.id: ${data.farm?.id ?? data.farm?.cloud_id ?? '—'}`);
console.log(`geo_features: ${features.length}`);
console.log(`plots: ${plots.length} | subareas: ${subareas.length}`);
console.log(`summary:`, summary);

const errors = [];
const warnings = [];

if (String(data.farm?.id ?? data.farm?.cloud_id ?? farmId).toLowerCase() !== farmId.toLowerCase()) {
  warnings.push('farm.id no payload difere do farmId da rota (verificar wrapper)');
}

if (features.length === 0) {
  errors.push('geo_features está vazio — mobile precisa exportar e fazer push geo_exports_all');
}

const talhaoFeatures = [];
const subareaFeatures = [];

for (let i = 0; i < features.length; i++) {
  const f = features[i];
  const geom = f.geometry;
  const props = f.properties ?? {};
  const tipo = String(props.tipo ?? '').toLowerCase();

  if (!geom || typeof geom !== 'object') {
    errors.push(`Feature[${i}] sem geometry`);
    continue;
  }
  const coords = JSON.stringify(geom);
  if (coords.includes('"0",0') || coords.includes('[0,0]')) {
    warnings.push(`Feature[${i}] possível coordenada 0,0`);
  }

  const farmCloud = props.farm_cloud_id;
  if (farmCloud && String(farmCloud).toLowerCase() !== farmId.toLowerCase()) {
    errors.push(`Feature[${i}] farm_cloud_id=${farmCloud} ≠ rota ${farmId}`);
  }

  for (const key of REQUIRED_PROPS) {
    if (tipo === 'talhao' && !props[key]) {
      warnings.push(`Feature[${i}] talhão sem ${key}`);
    }
  }

  const enrichedPresent = ENRICHED_PROPS.filter((k) => props[k] != null && props[k] !== '');
  if (tipo === 'talhao') talhaoFeatures.push({ i, props, enrichedPresent });
  if (tipo === 'subarea') subareaFeatures.push({ i, props });

  const hasMaterial =
    props.material || props.variedade || props.hibrido;
  if (tipo === 'talhao' && !hasMaterial) {
    warnings.push(`Feature[${i}] sem material/variedade/hibrido`);
  }
}

const plotIds = plots.map((p) => String(p.id ?? p.plot_local_id ?? ''));
const dupPlots = plotIds.filter((id, idx) => id && plotIds.indexOf(id) !== idx);
if (dupPlots.length) {
  errors.push(`plots duplicados: ${[...new Set(dupPlots)].join(', ')}`);
}

console.log(`\nTalhões com features: ${talhaoFeatures.length}`);
console.log(`Subáreas com features: ${subareaFeatures.length}`);

if (talhaoFeatures.length > 0) {
  const sample = talhaoFeatures[0];
  console.log('\nAmostra properties (1º talhão):');
  for (const k of [...REQUIRED_PROPS, ...ENRICHED_PROPS, 'tipo', 'farm_cloud_id', 'talhao_id']) {
    console.log(`  ${k}: ${sample.props[k] ?? '—'}`);
  }
  console.log(`  campos enriquecidos presentes: ${sample.enrichedPresent.join(', ') || 'nenhum'}`);
  const plantPresent = PLANTABILITY_PROPS.filter((k) => sample.props[k] != null && sample.props[k] !== '');
  console.log(`  plantabilidade: ${plantPresent.length ? plantPresent.join(', ') : 'nenhum (registre CV/estande no mobile)'}`);
}

let talhoesWithPlantability = 0;
for (const f of talhaoFeatures) {
  const present = PLANTABILITY_PROPS.some((k) => f.props[k] != null && f.props[k] !== '');
  if (present) talhoesWithPlantability += 1;
}
console.log(`\nTalhões com plantabilidade no GeoJSON: ${talhoesWithPlantability}/${talhaoFeatures.length}`);

if (errors.length) {
  console.log('\n❌ ERROS:');
  errors.forEach((e) => console.log('  -', e));
}
if (warnings.length) {
  console.log('\n⚠️ AVISOS:');
  warnings.forEach((w) => console.log('  -', w));
}

if (!errors.length) {
  console.log('\n✅ Endpoint planting-map OK (estrutura e isolamento básico).');
  if (warnings.length) console.log('   Revise avisos — alguns campos dependem de dados no mobile.');
  process.exit(0);
}
process.exit(1);
