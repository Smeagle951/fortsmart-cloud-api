import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '../src/db/migrations');
const destDir = path.join(__dirname, '../dist/db/migrations');

fs.mkdirSync(destDir, { recursive: true });
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.sql'));
for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
}
console.log(`Copied ${files.length} migration(s) to dist/db/migrations`);

const ndviSrc = path.join(__dirname, '../ndvi');
const ndviDest = path.join(__dirname, '../dist/ndvi');
if (fs.existsSync(ndviSrc)) {
  fs.mkdirSync(ndviDest, { recursive: true });
  for (const file of fs.readdirSync(ndviSrc)) {
    if (file.endsWith('.js')) {
      fs.copyFileSync(path.join(ndviSrc, file), path.join(ndviDest, file));
    }
  }
  console.log(`Copied NDVI module to dist/ndvi`);
}
