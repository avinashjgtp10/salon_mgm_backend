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
  min: parseInt(process.env.DB_POOL_MIN || '2'),
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  console.log('✅ Database connected');
});

pool.on('error', (err) => {
  console.error('❌ Database error:', err);
  process.exit(-1);
});

export default pool;
