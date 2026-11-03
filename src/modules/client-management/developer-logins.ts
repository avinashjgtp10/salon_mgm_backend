import bcrypt from "bcrypt";
import crypto from "crypto";
import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";

// A developer / team member can be given a Super Admin login: a normal users row (role 'super_admin') with the developer's
// email, linked through developers.user_id (add_developer_login_link.sql). Full Super Admin access, as chosen by the owner,
// so these accounts are created, reset and switched off only by a Super Admin, and are disabled whenever the developer is.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export function generatePassword(length = 12): string {
  let out = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function chooseNewPassword(given: unknown): string {
  if (given === undefined || given === null || given === "") return generatePassword();
  const p = String(given);
  if (p.length < 8) throw new AppError(400, "Password must be at least 8 characters", "VALIDATION_ERROR");
  if (/\s/.test(p)) throw new AppError(400, "Password cannot contain spaces", "VALIDATION_ERROR");
  return p;
}

// The migration may not be applied yet; say so plainly instead of a raw column error.
const wrapMissingColumn = (e: any): never => {
  if (e?.code === "42703") throw new AppError(409, "Run Migration/add_developer_login_link.sql first", "MIGRATION_REQUIRED");
  throw e;
};

export const developerLogins = {
  async emailInUse(email: string): Promise<boolean> {
    const { rows } = await pool.query(`SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1`, [String(email).toLowerCase().trim()]);
    return rows.length > 0;
  },

  async list() {
    try {
      const { rows } = await pool.query(
        `SELECT d.id AS developer_id, u.id AS user_id, u.is_active, u.last_login
           FROM developers d JOIN users u ON u.id = d.user_id`,
      );
      return rows;
    } catch (e) { return wrapMissingColumn(e); }
  },

  async create(developerId: string, password: unknown) {
    const plain = chooseNewPassword(password);
    const hash = await bcrypt.hash(plain, 10);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const { rows } = await c.query(`SELECT id, name, email, phone, is_active, user_id FROM developers WHERE id = $1 FOR UPDATE`, [developerId]);
      const dev = rows[0];
      if (!dev) throw new AppError(404, "Developer not found", "NOT_FOUND");
      if (dev.user_id) throw new AppError(409, "This developer already has a login", "ALREADY_EXISTS");
      if (!dev.is_active) throw new AppError(409, "Activate the developer before creating a login", "DEVELOPER_INACTIVE");
      const email = String(dev.email).toLowerCase().trim();
      const { rows: taken } = await c.query(`SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`, [email]);
      if (taken.length) throw new AppError(409, "An account with this email already exists", "EMAIL_TAKEN");
      const [first, ...rest] = String(dev.name).trim().split(/\s+/);
      const { rows: u } = await c.query(
        `INSERT INTO users (first_name, last_name, email, password_hash, phone, role, is_active, is_onboarding_complete)
         VALUES ($1,$2,$3,$4,$5,'super_admin', true, true) RETURNING id`,
        [first || dev.name, rest.join(" ") || null, email, hash, dev.phone ?? null],
      );
      await c.query(`UPDATE developers SET user_id = $2, updated_at = NOW() WHERE id = $1`, [developerId, u[0].id]);
      await c.query("COMMIT");
      return { user_id: u[0].id as string, email, password: plain };
    } catch (e: any) {
      await c.query("ROLLBACK");
      return wrapMissingColumn(e);
    } finally {
      c.release();
    }
  },

  /** New password for an existing login; every signed-in session of that account is ended. */
  async resetPassword(developerId: string, password: unknown) {
    const plain = chooseNewPassword(password);
    const hash = await bcrypt.hash(plain, 10);
    try {
      const { rows } = await pool.query(`SELECT d.user_id, d.email FROM developers d WHERE d.id = $1`, [developerId]);
      if (!rows[0]) throw new AppError(404, "Developer not found", "NOT_FOUND");
      if (!rows[0].user_id) throw new AppError(404, "This developer has no login yet", "NOT_FOUND");
      await pool.query(`UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`, [rows[0].user_id, hash]);
      await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [rows[0].user_id]);
      return { email: rows[0].email as string, password: plain };
    } catch (e) { return wrapMissingColumn(e); }
  },

  /** Switch the login on or off (off also ends its sessions). */
  async setActive(developerId: string, active: boolean) {
    try {
      const { rows } = await pool.query(`SELECT user_id FROM developers WHERE id = $1`, [developerId]);
      if (!rows[0]) throw new AppError(404, "Developer not found", "NOT_FOUND");
      if (!rows[0].user_id) throw new AppError(404, "This developer has no login yet", "NOT_FOUND");
      await pool.query(`UPDATE users SET is_active = $2, updated_at = NOW() WHERE id = $1`, [rows[0].user_id, active]);
      if (!active) await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [rows[0].user_id]);
      return { is_active: active };
    } catch (e) { return wrapMissingColumn(e); }
  },

  /** Used when a developer is deactivated or deleted: the login must not outlive them. Silent if there is no login or no migration. */
  async disableForDeveloper(developerId: string) {
    try {
      const { rows } = await pool.query(`SELECT user_id FROM developers WHERE id = $1`, [developerId]);
      const userId = rows[0]?.user_id;
      if (!userId) return;
      await pool.query(`UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`, [userId]);
      await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
    } catch (e: any) { if (e?.code !== "42703") throw e; }
  },
};

/** Contact details of a developer, kept in step with their login (if any). A password here resets or creates the login. */
export async function updateDeveloper(id: string, input: { name: unknown; email: unknown; phone: unknown; password: unknown }) {
  const name = String(input.name ?? "").trim();
  const email = String(input.email ?? "").toLowerCase().trim();
  const phone = String(input.phone ?? "").trim() || null;
  if (!name) throw new AppError(400, "Name is required", "VALIDATION_ERROR");
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new AppError(400, "Enter a valid email", "VALIDATION_ERROR");
  const wantsPassword = input.password !== undefined && input.password !== null && input.password !== "";
  const plain = wantsPassword ? chooseNewPassword(input.password) : null;

  const c = await pool.connect();
  let userId: string | null = null; let isActive = true;
  try {
    await c.query("BEGIN");
    const { rows } = await c.query(`SELECT id, is_active, user_id FROM developers WHERE id = $1 FOR UPDATE`, [id]);
    const dev = rows[0];
    if (!dev) throw new AppError(404, "Developer not found", "NOT_FOUND");
    userId = dev.user_id ?? null; isActive = dev.is_active;
    const { rows: dupDev } = await c.query(`SELECT 1 FROM developers WHERE LOWER(email) = $1 AND id <> $2`, [email, id]);
    if (dupDev.length) throw new AppError(409, "Another developer already uses this email", "EMAIL_TAKEN");
    const { rows: dupUser } = await c.query(`SELECT 1 FROM users WHERE LOWER(email) = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)`, [email, userId]);
    if (dupUser.length) throw new AppError(409, "An account with this email already exists", "EMAIL_TAKEN");
    await c.query(`UPDATE developers SET name = $2, email = $3, phone = $4, updated_at = NOW() WHERE id = $1`, [id, name, email, phone]);
    if (userId) {
      const [first, ...rest] = name.split(/\s+/);
      await c.query(`UPDATE users SET first_name = $2, last_name = $3, email = $4, phone = $5, updated_at = NOW() WHERE id = $1`, [userId, first, rest.join(" ") || null, email, phone]);
      if (plain) {
        await c.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, await bcrypt.hash(plain, 10)]);
        await c.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
      }
    }
    await c.query("COMMIT");
  } catch (e: any) {
    await c.query("ROLLBACK");
    return wrapMissingColumn(e);
  } finally {
    c.release();
  }
  let loginCreated = false;
  if (plain && !userId && isActive) { await developerLogins.create(id, plain); loginCreated = true; }
  return { id, name, email, phone, has_login: !!userId || loginCreated, password_changed: !!plain };
}
