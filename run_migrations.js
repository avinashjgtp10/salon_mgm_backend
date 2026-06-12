const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env' });
require('dotenv').config({ path: '.env.local' });

const sslConfig = process.env.DB_SSL === 'true'
  ? { rejectUnauthorized: false }
  : false;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: sslConfig,
  connectionTimeoutMillis: 15000,
});

// Run in this order so tables exist before dependent ALTER/INSERT statements
const MIGRATION_ORDER = [
  'create_billing_tables.sql',
  'add_trial_minutes_to_billing_plans.sql',
  'add_billing_plans_free_and_pro.sql',
  'create_blocked_times_table.sql',
  'add_payment_status_to_appointments.sql',
  'add_partial_to_payments_status.sql',
  'add_logo_cover_to_marketplace_profiles.sql',
  'add_unique_phone_number_id_to_whatsapp_configs.sql',
  'run_all_pending_staff_migrations.sql',
];

async function runMigrations() {
  const client = await pool.connect();
  try {
    for (const file of MIGRATION_ORDER) {
      const filePath = path.join(__dirname, 'migrations', file);
      if (!fs.existsSync(filePath)) {
        console.log(`⚠️  Skipping (not found): ${file}`);
        continue;
      }
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`\n▶  Running: ${file}`);
      // Wrap each file in a transaction so a failure is isolated
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
      } catch (sqlErr) {
        await client.query('ROLLBACK');
        throw sqlErr;
      }
      console.log(`✅ Done:    ${file}`);
    }
    console.log('\n🎉 All migrations completed successfully.');
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
