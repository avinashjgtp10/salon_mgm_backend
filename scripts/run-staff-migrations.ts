/**
 * One-time migration runner — adds missing columns to the staff table.
 * Run with:  npx ts-node scripts/run-staff-migrations.ts
 */
import pool from '../src/config/database';

const migrations: { name: string; sql: string }[] = [
  {
    name: 'add password_hash to staff',
    sql: `ALTER TABLE staff ADD COLUMN IF NOT EXISTS password_hash TEXT;`,
  },
  {
    name: 'add permission_level to staff',
    sql: `ALTER TABLE staff ADD COLUMN IF NOT EXISTS permission_level VARCHAR(20) DEFAULT 'low';`,
  },
  {
    name: 'add allow_calendar_bookings to staff',
    sql: `ALTER TABLE staff ADD COLUMN IF NOT EXISTS allow_calendar_bookings BOOLEAN DEFAULT true;`,
  },
  {
    name: 'add custom_permissions to staff',
    sql: `ALTER TABLE staff ADD COLUMN IF NOT EXISTS custom_permissions JSONB;`,
  },
];

async function run() {
  const client = await pool.connect();
  try {
    for (const m of migrations) {
      process.stdout.write(`Running: ${m.name} ... `);
      await client.query(m.sql);
      console.log('OK');
    }
    console.log('\n✅ All staff migrations applied successfully.');
  } catch (err: any) {
    console.error('\n❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
