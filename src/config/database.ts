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
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl:      sslConfig,
  min: 2,
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis:       60000,
  connectionTimeoutMillis:  8000,
  statement_timeout:       12000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('connect', () => { console.log('✅ Database connected'); });
pool.on('error',   (err) => { console.error('❌ Database error:', err); });

export default pool;

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
      console.warn('🔁 [safeQuery] Stale DB connection — retrying...');
      return safeQuery(queryFn, retries - 1);
    }
    throw err;
  }
}