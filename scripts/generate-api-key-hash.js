/**
 * Gera o mesmo SHA-256 que o servidor usa em src/utils/hashApiKey.ts
 * (update(`${rawKey}${pepper}`)).
 *
 * Uso (bash / Git Bash):
 *   API_KEY_PEPPER=seu_pepper node scripts/generate-api-key-hash.js fs_live_xxx
 *
 * PowerShell:
 *   $env:API_KEY_PEPPER="seu_pepper"; node scripts/generate-api-key-hash.js fs_live_xxx
 */
import crypto from 'node:crypto';

const apiKey = process.argv[2];
const pepper = process.env.API_KEY_PEPPER;

if (!apiKey || !pepper) {
  console.error(
    'Uso: API_KEY_PEPPER=seu_pepper node scripts/generate-api-key-hash.js fs_live_xxx',
  );
  console.error('(PowerShell: $env:API_KEY_PEPPER="..."; node scripts/generate-api-key-hash.js fs_live_xxx)');
  process.exit(1);
}

const hash = crypto.createHash('sha256').update(`${apiKey}${pepper}`, 'utf8').digest('hex');

console.log('API_KEY:', apiKey);
console.log('HASH:', hash);
console.log('PREFIX (primeiros 12 chars, para key_prefix):', apiKey.substring(0, 12));
