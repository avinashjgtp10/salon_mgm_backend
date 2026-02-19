import pool from "../../config/database";

export const authRepository = {
  // ===================== USERS =====================

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
   * Find user by ID (needed for refresh token)
   */
  async findUserById(userId: string) {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    return rows[0] || null;
  },

  /**
   * Create new user (supports extra registration fields)
   */
  async createUser(data: {
    email: string;
    phone?: string | null;
    password_hash: string;
    first_name: string;
    last_name?: string | null;
    role: string;

    business_name?: string | null;
    address?: string | null;
    country?: string | null;
    country_code?: string | null;
  }) {
    const { rows } = await pool.query(
      `INSERT INTO users (
          email, phone, password_hash, first_name, last_name, role,
          business_name, address, country, country_code
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING
         id, email, phone, first_name, last_name, role,
         business_name, address, country, country_code,
         avatar_url, is_verified, is_active, last_login, created_at, updated_at`,
      [
        data.email,
        data.phone ?? null,
        data.password_hash,
        data.first_name,
        data.last_name ?? null,
        data.role,
        data.business_name ?? null,
        data.address ?? null,
        data.country ?? null,
        data.country_code ?? null,
      ],
    );

    return rows[0];
  },

  /**
   * Mark user verified (after OTP verification)
   */
  async markUserVerified(userId: string) {
    const { rows } = await pool.query(
      `UPDATE users
       SET is_verified = TRUE, updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, is_verified, updated_at`,
      [userId],
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

  // ===================== OTP VERIFICATIONS =====================

  /**
   * Create OTP verification entry
   * (Store HASHED OTP in otp_code column for security)
   */
  async createOtpVerification(data: {
    user_id: string;
    otp_code: string; // hashed otp
    purpose: string;  // e.g. 'email_verification'
    expires_at: Date;
  }) {
    const { rows } = await pool.query(
      `INSERT INTO otp_verifications (user_id, otp_code, purpose, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, purpose, expires_at, is_used, created_at`,
      [data.user_id, data.otp_code, data.purpose, data.expires_at],
    );
    return rows[0];
  },

  /**
   * Get latest OTP for a user+purpose
   */
  async findLatestOtp(userId: string, purpose: string) {
    const { rows } = await pool.query(
      `SELECT *
       FROM otp_verifications
       WHERE user_id = $1 AND purpose = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, purpose],
    );
    return rows[0] || null;
  },

  /**
   * Mark OTP used
   */
  async markOtpUsed(otpId: string) {
    await pool.query(
      `UPDATE otp_verifications
       SET is_used = TRUE
       WHERE id = $1`,
      [otpId],
    );
  },

  // ===================== REFRESH TOKENS =====================

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