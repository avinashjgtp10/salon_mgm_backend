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

  /**
   * Update password
   */
  async updatePassword(userId: string, passwordHash: string) {
    await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [passwordHash, userId],
    );
  },

  /**
   * Promote a user to salon_owner (used when a client creates their first salon)
   */
  async upgradeToSalonOwner(userId: string) {
    const { rows } = await pool.query(
      `UPDATE users SET role = 'salon_owner', updated_at = NOW()
       WHERE id = $1 AND role != 'salon_owner'
       RETURNING id, role`,
      [userId],
    );
    return rows[0] ?? null; // null if already salon_owner (no-op)
  },

  /**
   * Get the salon ID owned by this user (null if none)
   */
  async findSalonIdByUserId(userId: string): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT id FROM salons WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    return rows[0]?.id ?? null;
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

  // ===================== ONBOARDING =====================

  /**
   * Mark onboarding as complete for a user
   */
  async markOnboardingComplete(userId: string) {
    await pool.query(
      `UPDATE users SET is_onboarding_complete = true WHERE id = $1`,
      [userId],
    );
  },

  // ===================== GOOGLE IDENTITIES =====================

  async findGoogleIdentity(providerUserId: string) {
    const { rows } = await pool.query(
      `SELECT u.*
       FROM user_identities ui
       JOIN users u ON u.id = ui.user_id
       WHERE ui.provider='google' AND ui.provider_user_id=$1
       LIMIT 1`,
      [providerUserId],
    );
    return rows[0] || null;
  },

  async createUserFromGoogle(profile: { email: string | null; fullName: string | null; avatarUrl: string | null }) {
    const full = profile.fullName?.trim() || "";
    const first = full ? full.split(" ")[0] : null;
    const last = full ? full.split(" ").slice(1).join(" ") || null : null;

    const { rows } = await pool.query(
      `INSERT INTO users(email, full_name, first_name, last_name, avatar_url, is_verified, role, password_hash)
       VALUES($1,$2,$3,$4,$5,TRUE,'client','')
       RETURNING *`,
      [profile.email, profile.fullName, first, last, profile.avatarUrl],
    );
    return rows[0];
  },

  async attachGoogleIdentity(userId: string, profile: { providerUserId: string; email: string | null }) {
    const { rows } = await pool.query(
      `INSERT INTO user_identities(user_id, provider, provider_user_id, email)
       VALUES($1,'google',$2,$3)
       ON CONFLICT (provider, provider_user_id) DO NOTHING
       RETURNING *`,
      [userId, profile.providerUserId, profile.email],
    );
    return rows[0] || null;
  },

  async updateUserBasics(userId: string, profile: { fullName: string | null; avatarUrl: string | null; email: string | null }) {
    const { rows } = await pool.query(
      `UPDATE users
       SET full_name = COALESCE($1, full_name),
           avatar_url = COALESCE($2, avatar_url),
           email = COALESCE($3, email),
           is_verified = TRUE,
           updated_at = NOW()
       WHERE id=$4
       RETURNING *`,
      [profile.fullName, profile.avatarUrl, profile.email, userId],
    );
    return rows[0];
  },
};
