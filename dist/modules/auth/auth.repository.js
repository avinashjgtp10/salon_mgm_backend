"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRepository = void 0;
const database_1 = __importDefault(require("../../config/database"));
exports.authRepository = {
    // ===================== USERS =====================
    /**
     * Find user by email
     */
    async findUserByEmail(email) {
        const { rows } = await database_1.default.query(`SELECT * FROM users WHERE email = $1 LIMIT 1`, [email]);
        return rows[0] || null;
    },
    /**
     * Find user by ID (needed for refresh token)
     */
    async findUserById(userId) {
        const { rows } = await database_1.default.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);
        return rows[0] || null;
    },
    /**
     * Create new user (supports extra registration fields)
     */
    async createUser(data) {
        const { rows } = await database_1.default.query(`INSERT INTO users (
          email, phone, password_hash, first_name, last_name, role,
          business_name, address, country, country_code
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING
         id, email, phone, first_name, last_name, role,
         business_name, address, country, country_code,
         avatar_url, is_verified, is_active, last_login, created_at, updated_at`, [
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
        ]);
        return rows[0];
    },
    /**
     * Mark user verified (after OTP verification)
     */
    async markUserVerified(userId) {
        const { rows } = await database_1.default.query(`UPDATE users
       SET is_verified = TRUE, updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, is_verified, updated_at`, [userId]);
        return rows[0];
    },
    /**
     * Update last login time
     */
    async updateLastLogin(userId) {
        await database_1.default.query(`UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1`, [userId]);
    },
    // ===================== OTP VERIFICATIONS =====================
    /**
     * Create OTP verification entry
     * (Store HASHED OTP in otp_code column for security)
     */
    async createOtpVerification(data) {
        const { rows } = await database_1.default.query(`INSERT INTO otp_verifications (user_id, otp_code, purpose, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, purpose, expires_at, is_used, created_at`, [data.user_id, data.otp_code, data.purpose, data.expires_at]);
        return rows[0];
    },
    /**
     * Get latest OTP for a user+purpose
     */
    async findLatestOtp(userId, purpose) {
        const { rows } = await database_1.default.query(`SELECT *
       FROM otp_verifications
       WHERE user_id = $1 AND purpose = $2
       ORDER BY created_at DESC
       LIMIT 1`, [userId, purpose]);
        return rows[0] || null;
    },
    /**
     * Mark OTP used
     */
    async markOtpUsed(otpId) {
        await database_1.default.query(`UPDATE otp_verifications
       SET is_used = TRUE
       WHERE id = $1`, [otpId]);
    },
    // ===================== REFRESH TOKENS =====================
    /**
     * Save refresh token
     */
    async saveRefreshToken(data) {
        const { rows } = await database_1.default.query(`INSERT INTO refresh_tokens (user_id, token, expires_at)
       VALUES ($1,$2,$3)
       RETURNING id, user_id, token, expires_at, created_at`, [data.user_id, data.token, data.expires_at]);
        return rows[0];
    },
    /**
     * Find refresh token
     */
    async findRefreshToken(token) {
        const { rows } = await database_1.default.query(`SELECT * FROM refresh_tokens WHERE token = $1 LIMIT 1`, [token]);
        return rows[0] || null;
    },
    /**
     * Delete refresh token
     */
    async deleteRefreshToken(token) {
        await database_1.default.query(`DELETE FROM refresh_tokens WHERE token = $1`, [token]);
    },
    /**
     * Delete all refresh tokens for user (optional security feature)
     */
    async deleteAllRefreshTokensForUser(userId) {
        await database_1.default.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
    },
    // ===================== GOOGLE IDENTITIES =====================
    async findGoogleIdentity(providerUserId) {
        const { rows } = await database_1.default.query(`SELECT u.*
       FROM user_identities ui
       JOIN users u ON u.id = ui.user_id
       WHERE ui.provider='google' AND ui.provider_user_id=$1
       LIMIT 1`, [providerUserId]);
        return rows[0] || null;
    },
    async createUserFromGoogle(profile) {
        const full = profile.fullName?.trim() || "";
        const first = full ? full.split(" ")[0] : null;
        const last = full ? full.split(" ").slice(1).join(" ") || null : null;
        const { rows } = await database_1.default.query(`INSERT INTO users(email, full_name, first_name, last_name, avatar_url, is_verified, role, password_hash)
       VALUES($1,$2,$3,$4,$5,TRUE,'client','')
       RETURNING *`, [profile.email, profile.fullName, first, last, profile.avatarUrl]);
        return rows[0];
    },
    async attachGoogleIdentity(userId, profile) {
        const { rows } = await database_1.default.query(`INSERT INTO user_identities(user_id, provider, provider_user_id, email)
       VALUES($1,'google',$2,$3)
       ON CONFLICT (provider, provider_user_id) DO NOTHING
       RETURNING *`, [userId, profile.providerUserId, profile.email]);
        return rows[0] || null;
    },
    async updateUserBasics(userId, profile) {
        const { rows } = await database_1.default.query(`UPDATE users
       SET full_name = COALESCE($1, full_name),
           avatar_url = COALESCE($2, avatar_url),
           email = COALESCE($3, email),
           is_verified = TRUE,
           updated_at = NOW()
       WHERE id=$4
       RETURNING *`, [profile.fullName, profile.avatarUrl, profile.email, userId]);
        return rows[0];
    },
};
//# sourceMappingURL=auth.repository.js.map