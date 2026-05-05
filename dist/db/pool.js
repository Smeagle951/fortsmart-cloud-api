import pg from 'pg';
const { Pool } = pg;
let pool = null;
export function getPool() {
    if (pool)
        return pool;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is required');
    }
    pool = new Pool({
        connectionString,
        max: 20,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
    });
    return pool;
}
export async function closePool() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}
//# sourceMappingURL=pool.js.map