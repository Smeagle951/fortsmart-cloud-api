/**
 * Gera .local/render-r2-vars.txt após criar o token S3 no painel R2.
 * Uso (PowerShell, na pasta fortsmart-cloud-api):
 *   $env:R2_ACCESS_KEY_ID = '...'
 *   $env:R2_SECRET_ACCESS_KEY = '...'
 *   node scripts/finalize-r2-render-vars.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ACCOUNT_ID = '061588998c38a23fd2ae642e195905e4';
const BUCKET = 'fortsmart-media';
const PUBLIC_BASE = 'https://pub-3209281118214b86a5e8ff73205fa916.r2.dev';
const ENDPOINT = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;

const accessKeyId = String(process.env.R2_ACCESS_KEY_ID ?? '').trim();
const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY ?? '').trim();

if (!accessKeyId || !secretAccessKey) {
  console.error('Defina R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY no ambiente antes de executar.');
  console.error('Crie o token em: https://dash.cloudflare.com/?to=/:account/r2/api-tokens');
  process.exit(1);
}

const lines = [
  `R2_ACCOUNT_ID=${ACCOUNT_ID}`,
  `R2_ACCESS_KEY_ID=${accessKeyId}`,
  `R2_SECRET_ACCESS_KEY=${secretAccessKey}`,
  `R2_BUCKET_NAME=${BUCKET}`,
  `R2_ENDPOINT=${ENDPOINT}`,
  `R2_PUBLIC_BASE_URL=${PUBLIC_BASE}`,
  `FORTSMART_S3_REGION=auto`,
  `FORTSMART_S3_ENDPOINT=${ENDPOINT}`,
  `FORTSMART_S3_BUCKET=${BUCKET}`,
  `FORTSMART_S3_ACCESS_KEY=${accessKeyId}`,
  `FORTSMART_S3_SECRET_KEY=${secretAccessKey}`,
  `FORTSMART_S3_PUBLIC_BASE_URL=${PUBLIC_BASE}`,
];

const outDir = join(process.cwd(), '.local');
await mkdir(outDir, { recursive: true });
const outPath = join(outDir, 'render-r2-vars.txt');
await writeFile(outPath, `${lines.join('\n')}\n`, 'utf8');

console.log(`Arquivo gerado: ${outPath}`);
console.log('Cole no Render → Environment → Add from .env e faça Manual Deploy.');
