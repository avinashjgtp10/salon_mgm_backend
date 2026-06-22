/**
 * Promote avinash@salonox.com to super_admin and update password.
 * Run:  npx ts-node src/seeds/update.superadmin.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import bcrypt from "bcrypt";
import pool from "../config/database";

const TARGET_EMAIL = "avinash@salonox.com";
const NEW_PASSWORD = "admin2702";

async function run() {
  console.log("\n🔧 Updating super admin credentials...\n");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const password_hash = await bcrypt.hash(NEW_PASSWORD, 10);

    // 1. Demote old super_admin(s) that don't have the target email
    const { rowCount: demoted } = await client.query(
      `UPDATE users SET role = 'owner', updated_at = NOW()
       WHERE role = 'super_admin' AND email != $1`,
      [TARGET_EMAIL]
    );
    if ((demoted ?? 0) > 0) console.log(`   ℹ️  Demoted ${demoted} old super_admin(s) to 'owner'.`);

    // 2. Promote target user and update password
    const { rows, rowCount } = await client.query(
      `UPDATE users
       SET role          = 'super_admin',
           password_hash = $1,
           is_active     = true,
           is_verified   = true,
           updated_at    = NOW()
       WHERE email = $2
       RETURNING id, email, role`,
      [password_hash, TARGET_EMAIL]
    );

    if ((rowCount ?? 0) === 0) {
      // User doesn't exist yet — create them
      const { rows: created } = await client.query(
        `INSERT INTO users (email, first_name, last_name, password_hash, role, is_verified, is_active)
         VALUES ($1, 'Avinash', NULL, $2, 'super_admin', true, true)
         RETURNING id, email, role`,
        [TARGET_EMAIL, password_hash]
      );
      console.log("✅ Super admin created!");
      console.log(`   ID    : ${created[0].id}`);
    } else {
      console.log("✅ Super admin updated!");
      console.log(`   ID    : ${rows[0].id}`);
    }

    await client.query("COMMIT");
    console.log(`   Email    : ${TARGET_EMAIL}`);
    console.log(`   Password : ${NEW_PASSWORD}`);
    console.log(`   Role     : super_admin\n`);

  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("❌ Failed:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
