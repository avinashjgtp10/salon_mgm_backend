/**
 * Run from the backend folder:
 *   node scripts/set-staff-password.js
 */

require("dotenv").config();
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const STAFF_EMAIL = "shivanidiapk122004@gmail.com";
const NEW_PASSWORD = "Shivani@2004";

const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME     || "salon_dev",
  user:     process.env.DB_USER     || "postgres",
  password: process.env.DB_PASSWORD || "",
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function run() {
  const passwordHash = await bcrypt.hash(NEW_PASSWORD, 10);

  // Check if the user already exists
  const { rows } = await pool.query(
    "SELECT id, email, role FROM users WHERE email = $1",
    [STAFF_EMAIL]
  );

  if (rows.length > 0) {
    // Update existing user's password
    await pool.query(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2",
      [passwordHash, STAFF_EMAIL]
    );
    console.log(`✓ Password updated for existing user: ${STAFF_EMAIL}`);
  } else {
    // Create new user account for this staff member
    const { rows: newRows } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_verified)
       VALUES ($1, $2, $3, $4, 'staff', true)
       RETURNING id`,
      [STAFF_EMAIL, passwordHash, "shivani", "dhumal"]
    );
    const newUserId = newRows[0].id;
    console.log(`✓ New user account created: ${STAFF_EMAIL} (id: ${newUserId})`);

    // Link this user to the staff record
    await pool.query(
      `UPDATE staff SET user_id = $1, updated_at = NOW() WHERE email = $2`,
      [newUserId, STAFF_EMAIL]
    );
    console.log(`✓ User linked to staff record`);
  }

  console.log(`\n  Email:    ${STAFF_EMAIL}`);
  console.log(`  Password: ${NEW_PASSWORD}`);
  console.log(`\nStaff member can now log in.`);

  await pool.end();
}

run().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
