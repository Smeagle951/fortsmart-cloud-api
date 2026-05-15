import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Neon / Supabase / RDS e muitos Postgres na cloud exigem TLS. Variável
 * explícita permite forçar sem depender da URL (ver `.env.example`).
 */
function sslConfig(connectionString: string): { rejectUnauthorized: boolean } | undefined {
  const off = process.env.DATABASE_SSL === '0' || process.env.DATABASE_SSL === 'false';
  if (off) return undefined;
  const on = process.env.DATABASE_SSL === '1' || process.env.DATABASE_SSL === 'true';
  if (on) return { rejectUnauthorized: false };
  if (/sslmode=require|sslmode=no-verify|sslmode=verify-full/i.test(connectionString)) {
    return { rejectUnauthorized: false };
  }
  if (/neon\.tech|supabase\.co|pooler\.|amazonaws\.com|aiven\.cloud|render\.com/i.test(connectionString)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

export function getPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }
  const ssl = sslConfig(connectionString);
  pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ...(ssl ? { ssl } : {}),
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
