import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

function readConnectionString(): string {
  const raw =
    process.env.DATABASE_URL ??
    process.env.URL_DO_BANCO_DE_DADOS ??
    process.env.POSTGRES_URL ??
    '';
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed) {
    throw new Error(
      'DATABASE_URL is required. Também aceito URL_DO_BANCO_DE_DADOS como fallback.',
    );
  }
  return trimmed;
}

export function getPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = readConnectionString();
  pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
