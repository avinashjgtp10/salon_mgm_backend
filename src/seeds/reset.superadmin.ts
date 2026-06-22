import dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import bcrypt from "bcrypt";
import pool from "../config/database";

const EMAIL    = "pagalerutuja763@gmail.com";
const PASSWORD = "Pagale@12";

async function run() {
  console.log(`\nResetting super admin: ${EMAIL}\n`);
  try {
    const hash = await bcrypt.hash(PASSWORD, 10);

    const { rows } = await pool.query(
      `UPDATE users
         SET password_hash = $1,
             role          = 'super_admin',
             is_active     = true,
             is_verified   = true,
             updated_at    = NOW()
       WHERE email = $2
       RETURNING id, email, role`,
      [hash, EMAIL]
    );

    if (rows.length === 0) {
      // User doesn't exist at all — create fresh
      const { rows: created } = await pool.query(
        `INSERT INTO users (email, first_name, last_name, password_hash, role, is_verified, is_active)
         VALUES ($1, 'Super', 'Admin', $2, 'super_admin', true, true)
         RETURNING id, email, role`,
        [EMAIL, hash]
      );
      console.log("✅ Created new super admin:", created[0]);
    } else {
      console.log("✅ Updated existing user:", rows[0]);
    }

    console.log(`\n   Email    : ${EMAIL}`);
    console.log(`   Password : ${PASSWORD}`);
    console.log(`   Login at : http://localhost:5173/super-admin/login\n`);

  } catch (err: any) {
    console.error("❌ Error:", err.message);
  } finally {
    await pool.end();
  }
}

run();
