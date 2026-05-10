import { Pool } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env.local' });

const sslConfig = (() => {
  if (process.env.DB_SSL !== 'true') return false;
  const caPath = process.env.DB_CA_PATH;
  if (caPath) {
    try {
      return {
        rejectUnauthorized: false,
        ca: fs.readFileSync(path.resolve(caPath)).toString(),
      };
    } catch {
      console.warn('⚠️  Could not read DB_CA_PATH, using SSL without CA cert');
    }
  }
  return { rejectUnauthorized: false };
})();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: sslConfig,
  // Keep min at 0 so the pool doesn't hold persistent idle connections
  // that cloud DBs (Supabase/Neon/Render) silently kill, causing
  // "Connection terminated unexpectedly" on the next query.
  min: 0,
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  // Idle connections are closed after 10s — well before cloud DB kills them
  idleTimeoutMillis: 10000,
  // How long to wait for a new connection to be established
  connectionTimeoutMillis: 10000,
  // TCP keepalive: sends a heartbeat packet so the OS/network never
  // silently drops a connection that pg-pool still thinks is alive.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('connect', () => {
  console.log('✅ Database connected');
});

pool.on('error', (err) => {
  console.error('❌ Database error:', err);
  // Do NOT exit the process on idle client errors. The pg pool will automatically remove
  // the errored client and create a new one when a query is issued. 
  // Exiting here causes the entire backend to crash unnecessarily.
});

export default pool;

/**
 * safeQuery — wraps any pool.query() call with a single auto-retry.
 *
 * WHY: Cloud databases (Supabase, Neon, Render, Railway, etc.) silently
 * terminate idle PostgreSQL connections. pg-pool doesn't detect this until
 * the next query attempt, causing "Connection terminated unexpectedly".
 * One retry is enough because the pool discards the dead client and opens
 * a fresh connection for the second attempt.
 *
 * USAGE:
 *   const { rows } = await safeQuery(() => pool.query(sql, params));
 */
export async function safeQuery<T>(queryFn: () => Promise<T>, retries = 1): Promise<T> {
  try {
    return await queryFn();
  } catch (err: any) {
    const isStaleConn =
      err?.message?.includes('Connection terminated unexpectedly') ||
      err?.message?.includes('terminating connection') ||
      err?.message?.includes('Connection terminated') ||
      err?.code === 'ECONNRESET';

    if (retries > 0 && isStaleConn) {
      console.warn('🔁 [safeQuery] Stale DB connection detected — retrying query...');
      return safeQuery(queryFn, retries - 1);
    }
    throw err;
  }
}
