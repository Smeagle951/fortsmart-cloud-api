import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function ensureMigrationsTable(client: import('pg').PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function main(): Promise<void> {
  const pool = getPool();
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    for (const file of files) {
      const { rows } = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [
        file,
      ]);
      if (rows.length > 0) {
        console.log(`skip ${file}`);
        continue;
      }
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`applied ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    client.release();
    await closePool();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
