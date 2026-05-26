import { spawn } from 'node:child_process';
import 'dotenv/config';
import { createApp } from './app.js';
import { API_CAPABILITIES_VERSION } from './routes/health.routes.js';
const port = Number(process.env.PORT || 3000);
const host = '0.0.0.0';
const app = createApp();
console.log('[FortSmart API] booting');
console.log(`[FortSmart API] NODE_ENV=${process.env.NODE_ENV || 'development'}`);
console.log(`[FortSmart API] PORT=${port}`);
console.log(`[FortSmart API] DATABASE_URL=${process.env.DATABASE_URL ? 'present' : 'missing'}`);
console.log(`[FortSmart API] API_KEY_PEPPER=${process.env.API_KEY_PEPPER ? 'present' : 'missing'}`);
console.log(`[FortSmart API] capabilities_version=${API_CAPABILITIES_VERSION}`);
console.log('[FortSmart API] routes mounted');
function runMigrationsInBackground() {
    if (!process.env.DATABASE_URL) {
        console.warn('[FortSmart API] migrations skipped: DATABASE_URL missing');
        return;
    }
    if (process.env.DISABLE_BOOT_MIGRATIONS === '1') {
        console.log('[FortSmart API] migrations skipped: DISABLE_BOOT_MIGRATIONS=1');
        return;
    }
    const child = spawn(process.execPath, ['dist/db/migrate.js'], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
        console.log(`[FortSmart API][migrate] ${chunk.toString().trim()}`);
    });
    child.stderr.on('data', (chunk) => {
        console.error(`[FortSmart API][migrate] ${chunk.toString().trim()}`);
    });
    child.on('exit', (code) => {
        if (code === 0) {
            console.log('[FortSmart API] migrations completed');
            return;
        }
        console.error(`[FortSmart API] migrations failed with exit code ${code}; API remains online for /health`);
    });
}
app.listen(port, host, () => {
    console.log(`[FortSmart API] listening on ${host}:${port}`);
    runMigrationsInBackground();
});
//# sourceMappingURL=server.js.map