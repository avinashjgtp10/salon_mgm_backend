import pool from "../../config/database";

export const authRepository = {
  /**
   * Find user by email
   */
  async findUserByEmail(email: string) {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    return rows[0] || null;
  },

  /**
   * ✅ Find user by ID (needed for refresh token)
   */
  async findUserById(userId: string) {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    return rows[0] || null;
  },

  /**
   * Create new user
   */
  async createUser(data: {
    email: string;
    phone?: string | null;
    password_hash: string;
    first_name: string;
    last_name?: string | null;
    role: string;
  }) {
    const { rows } = await pool.query(
      `INSERT INTO users (email, phone, password_hash, first_name, last_name, role)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, email, phone, first_name, last_name, role, avatar_url, is_verified, is_active, last_login, created_at, updated_at`,
      [
        data.email,
        data.phone ?? null,
        data.password_hash,
        data.first_name,
        data.last_name ?? null,
        data.role,
      ],
    );
    return rows[0];
  },

  /**
   * Update last login time
   */
  async updateLastLogin(userId: string) {
    await pool.query(
      `UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1`,
      [userId],
    );
  },

  /**
   * Save refresh token
   */
  async saveRefreshToken(data: {
    user_id: string;
    token: string;
    expires_at: Date;
  }) {
    const { rows } = await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1,$2,$3)
       RETURNING id, user_id, token, expires_at, created_at`,
      [data.user_id, data.token, data.expires_at],
    );
    return rows[0];
  },

  /**
   * Find refresh token
   */
  async findRefreshToken(token: string) {
    const { rows } = await pool.query(
      `SELECT * FROM refresh_tokens WHERE token = $1 LIMIT 1`,
      [token],
    );
    return rows[0] || null;
  },

  /**
   * Delete refresh token
   */
  async deleteRefreshToken(token: string) {
    await pool.query(`DELETE FROM refresh_tokens WHERE token = $1`, [token]);
  },

  /**
   * Delete all refresh tokens for user (optional security feature)
   */
  async deleteAllRefreshTokensForUser(userId: string) {
    await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
  },
};
