/**
 * Seed: create the super admin user.
 *
 * Run once:
 *   npx ts-node src/seeds/seed.superadmin.ts
 *
 * Set credentials via env vars or edit the defaults below:
 *   SUPER_ADMIN_EMAIL=admin@salonox.com
 *   SUPER_ADMIN_PASSWORD=ChangeMe@123
 *   SUPER_ADMIN_NAME=Super Admin
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import bcrypt from "bcrypt";
import pool from "../config/database";

const EMAIL    = process.env.SUPER_ADMIN_EMAIL    ?? "admin@salonox.com";
const PASSWORD = process.env.SUPER_ADMIN_PASSWORD ?? "ChangeMe@123";
const NAME     = process.env.SUPER_ADMIN_NAME     ?? "Super Admin";

async function seedSuperAdmin() {
  console.log("\n🌱 Seeding super admin user...\n");

  try {
    // Check if already exists
    const { rows: existing } = await pool.query(
      `SELECT id, email, role FROM users WHERE email = $1 LIMIT 1`,
      [EMAIL]
    );

    if (existing.length > 0) {
      const user = existing[0];
      if (user.role === "super_admin") {
        console.log(`✅ Super admin already exists — email: ${user.email}, id: ${user.id}`);
        console.log("   Delete the row first to re-seed.");
        return;
      }
      // Exists but with a different role — upgrade to super_admin
      console.log(`⚠️  User exists with role "${user.role}" — upgrading to super_admin...`);
      await pool.query(
        `UPDATE users SET role = 'super_admin', updated_at = NOW() WHERE id = $1`,
        [user.id]
      );
      console.log(`✅ User upgraded to super_admin — id: ${user.id}`);
      return;
    }

    const [first_name, ...rest] = NAME.trim().split(" ");
    const last_name = rest.join(" ") || null;
    const password_hash = await bcrypt.hash(PASSWORD, 10);

    const { rows } = await pool.query(
      `INSERT INTO users (email, first_name, last_name, password_hash, role, is_verified, is_active)
       VALUES ($1, $2, $3, $4, 'super_admin', true, true)
       RETURNING id, email, role`,
      [EMAIL, first_name, last_name, password_hash]
    );

    const user = rows[0];
    console.log("✅ Super admin created successfully!");
    console.log(`   ID    : ${user.id}`);
    console.log(`   Email : ${user.email}`);
    console.log(`   Role  : ${user.role}`);
    console.log(`   Pass  : ${PASSWORD}`);
    console.log("\n⚠️  Change the password after first login!\n");

  } catch (err: any) {
    console.error("❌ Failed:", err.message);
    throw err;
  } finally {
    await pool.end();
  }
}

seedSuperAdmin().catch((err) => {
  console.error(err);
  process.exit(1);
});
