import { Pool, types } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

// ✅ Return timestamps as raw ISO strings instead of JS Date objects.
// This prevents the pg driver from silently shifting timezone during
// Date construction. The frontend is responsible for parsing & display.
types.setTypeParser(1114, (val: string) => val);  // TIMESTAMP WITHOUT TZ
types.setTypeParser(1184, (val: string) => val);  // TIMESTAMP WITH TZ (timestamptz)

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
  max: parseInt(process.env.DB_POOL_MAX || '20'),
  // Idle connections are closed after 10s — well before cloud DB kills them
  idleTimeoutMillis: 10000,
  // Raised from 10s to 20s — dashboard fires 6 parallel queries; under load
  // the pool needs more headroom before giving up on a new connection.
  connectionTimeoutMillis: 20000,
  // TCP keepalive: sends a heartbeat packet so the OS/network never
  // silently drops a connection that pg-pool still thinks is alive.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('connect', (client) => {
  // ✅ Force UTC on every session so timestamp casts are always timezone-consistent.
  // Without this, bare strings like "2026-05-26T10:30:00" would be interpreted using
  // whatever the OS/cloud-DB default timezone is (varies by host).
  client.query("SET TIME ZONE 'UTC'").catch((err) =>
    console.warn('⚠️  Could not set session timezone:', err.message)
  );
  console.log('✅ Database connected (session TZ = UTC)');
});

pool.on('error', (err) => {
  console.error('❌ Database error:', err);
  // Do NOT exit the process on idle client errors. The pg pool will automatically remove
  // the errored client and create a new one when a query is issued. 
  // Exiting here causes the entire backend to crash unnecessarily.
});

export default pool;

// Add login_count column if it doesn't exist yet (safe, idempotent)
setImmediate(() => {
  pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER DEFAULT 0`)
    .catch((err: any) => console.warn('⚠️  login_count column migration:', err.message));
});

// Add extra profile fields to salons table (safe, idempotent)
setImmediate(() => {
  pool.query(`
    ALTER TABLE salons
      ADD COLUMN IF NOT EXISTS address           TEXT,
      ADD COLUMN IF NOT EXISTS city              TEXT,
      ADD COLUMN IF NOT EXISTS state             TEXT,
      ADD COLUMN IF NOT EXISTS country           TEXT,
      ADD COLUMN IF NOT EXISTS pincode           TEXT,
      ADD COLUMN IF NOT EXISTS timezone          TEXT DEFAULT 'Asia/Kolkata',
      ADD COLUMN IF NOT EXISTS currency          TEXT DEFAULT 'INR',
      ADD COLUMN IF NOT EXISTS business_category TEXT
  `).catch((err: any) => console.warn('⚠️  salons extra fields migration:', err.message));
});

// Create support_tickets table (safe, idempotent)
setImmediate(() => {
  pool.query(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id     UUID REFERENCES salons(id) ON DELETE CASCADE,
      user_id      UUID REFERENCES users(id)  ON DELETE SET NULL,
      subject      TEXT NOT NULL,
      category     TEXT NOT NULL DEFAULT 'general',
      message      TEXT NOT NULL,
      priority     TEXT NOT NULL DEFAULT 'medium',
      status       TEXT NOT NULL DEFAULT 'open',
      admin_reply  TEXT,
      replied_at   TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch((err: any) => console.warn('⚠️  support_tickets table migration:', err.message));
});

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
