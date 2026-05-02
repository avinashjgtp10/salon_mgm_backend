import { config } from "dotenv";
import path from "path";
config({ path: path.join(__dirname, "../.env.local") });

import { Pool } from "pg";

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    const res = await pool.query(`
      CREATE TABLE IF NOT EXISTS marketplace_booking_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        profile_id UUID NOT NULL UNIQUE REFERENCES marketplace_profiles(id) ON DELETE CASCADE,
        max_advance_booking INT NOT NULL DEFAULT 60,
        min_notice_period INT NOT NULL DEFAULT 0,
        cancellation_notice INT NOT NULL DEFAULT 24,
        slot_interval INT NOT NULL DEFAULT 30,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      SELECT * FROM marketplace_booking_settings LIMIT 1;
    `);
    console.log("Table created/checked successfully.");
    console.log(res);
  } catch (err) {
    console.error("Error executing query", err);
  } finally {
    process.exit(0);
  }
}

run();
