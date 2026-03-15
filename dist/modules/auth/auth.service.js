"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const error_middleware_1 = require("../../middleware/error.middleware");
const auth_repository_1 = require("./auth.repository");
const otp_util_1 = require("../utils/otp.util");
const email_service_1 = require("../utils/email.service");
const exotel_service_1 = require("../utils/exotel.service");
const logger_1 = __importDefault(require("../../config/logger"));
const crypto_1 = __importDefault(require("crypto"));
const axios_1 = __importDefault(require("axios"));
const redis_1 = __importDefault(require("../../config/redis"));
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "";
const accessOptions = {
    expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || "15m"),
};
const refreshOptions = {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || "30d"),
};
function assertEnv() {
    if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
        throw new Error("JWT secrets missing in env");
    }
}
function signAccessToken(payload) {
    return jsonwebtoken_1.default.sign(payload, ACCESS_SECRET, accessOptions);
}
function signRefreshToken(payload) {
    return jsonwebtoken_1.default.sign(payload, REFRESH_SECRET, refreshOptions);
}
function refreshExpiryDate() {
    const days = 30;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
function splitFullName(fullName) {
    const name = String(fullName || "").trim().replace(/\s+/g, " ");
    if (!name)
        return { first_name: "", last_name: null };
    const parts = name.split(" ");
    const first_name = parts[0];
    const last_name = parts.length > 1 ? parts.slice(1).join(" ") : null;
    return { first_name, last_name };
}
const STATE_PREFIX = "google:state:";
const STATE_TTL_SECONDS = 10 * 60;
function base64url(buf) {
    return buf
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}
function randomString(bytes = 32) {
    return base64url(crypto_1.default.randomBytes(bytes));
}
function sha256Base64Url(input) {
    const hash = crypto_1.default.createHash("sha256").update(input).digest();
    return base64url(hash);
}
exports.authService = {
    async register(body) {
        logger_1.default.info("[authService.register] Start", { email: body?.email });
        assertEnv();
        const email = String(body.email || "").trim().toLowerCase();
        if (!email)
            throw new error_middleware_1.AppError(400, "Email is required", "VALIDATION_ERROR");
        if (!body.password)
            throw new error_middleware_1.AppError(400, "Password is required", "VALIDATION_ERROR");
        if (!body.fullName?.trim())
            throw new error_middleware_1.AppError(400, "Full name is required", "VALIDATION_ERROR");
        if (body.terms !== true) {
            logger_1.default.warn("[authService.register] Terms not accepted", { email });
            throw new error_middleware_1.AppError(400, "Terms must be accepted", "TERMS_NOT_ACCEPTED");
        }
        const existing = await auth_repository_1.authRepository.findUserByEmail(email);
        if (existing) {
            logger_1.default.warn("[authService.register] Email already exists", { email });
            throw new error_middleware_1.AppError(409, "Email already exists", "EMAIL_EXISTS");
        }
        const { first_name, last_name } = splitFullName(body.fullName);
        const password_hash = await bcrypt_1.default.hash(body.password, 10);
        const role = body.businessName?.trim() ? "salon_owner" : "client";
        logger_1.default.info("[authService.register] Creating user", { email, role });
        const user = await auth_repository_1.authRepository.createUser({
            email,
            phone: body.phone?.trim() ? body.phone.trim() : null,
            password_hash,
            first_name,
            last_name,
            role,
            business_name: body.businessName?.trim() ? body.businessName.trim() : null,
            address: body.address?.trim() ? body.address.trim() : null,
            country: body.country?.trim() ? body.country.trim() : null,
            country_code: body.countryCode?.trim() ? body.countryCode.trim() : null,
        });
        logger_1.default.info("[authService.register] User created successfully", { email, userId: user?.id, role });
        return user;
    },
    async login(body) {
        logger_1.default.info("[authService.login] Start", { email: body?.email });
        assertEnv();
        const email = String(body.email || "").trim().toLowerCase();
        const password = String(body.password || "");
        const user = await auth_repository_1.authRepository.findUserByEmail(email);
        if (!user) {
            logger_1.default.warn("[authService.login] User not found", { email });
            throw new error_middleware_1.AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");
        }
        if (user.is_active === false) {
            logger_1.default.warn("[authService.login] User is inactive", { email, userId: user.id });
            throw new error_middleware_1.AppError(403, "User is inactive", "USER_INACTIVE");
        }
        const ok = await bcrypt_1.default.compare(password, user.password_hash);
        if (!ok) {
            logger_1.default.warn("[authService.login] Wrong password", { email });
            throw new error_middleware_1.AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");
        }
        await auth_repository_1.authRepository.updateLastLogin(user.id);
        const accessToken = signAccessToken({ userId: user.id, role: user.role });
        const refreshToken = signRefreshToken({ userId: user.id });
        await auth_repository_1.authRepository.saveRefreshToken({
            user_id: user.id,
            token: refreshToken,
            expires_at: refreshExpiryDate(),
        });
        logger_1.default.info("[authService.login] Login successful", { email, userId: user.id, role: user.role });
        return {
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                first_name: user.first_name,
                last_name: user.last_name,
            },
        };
    },
    async refresh(refreshToken) {
        logger_1.default.info("[authService.refresh] Token refresh requested");
        assertEnv();
        const saved = await auth_repository_1.authRepository.findRefreshToken(refreshToken);
        if (!saved) {
            logger_1.default.warn("[authService.refresh] Refresh token not found in DB");
            throw new error_middleware_1.AppError(401, "Invalid refresh token", "INVALID_REFRESH");
        }
        if (new Date(saved.expires_at).getTime() < Date.now()) {
            logger_1.default.warn("[authService.refresh] Refresh token expired", { userId: saved.user_id });
            await auth_repository_1.authRepository.deleteRefreshToken(refreshToken);
            throw new error_middleware_1.AppError(401, "Refresh token expired", "REFRESH_EXPIRED");
        }
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(refreshToken, REFRESH_SECRET);
        }
        catch (jwtErr) {
            logger_1.default.error("[authService.refresh] JWT verify failed", { error: jwtErr.message });
            throw new error_middleware_1.AppError(401, "Invalid refresh token", "INVALID_REFRESH");
        }
        const userId = decoded.userId;
        const user = await auth_repository_1.authRepository.findUserById(userId);
        if (!user) {
            logger_1.default.warn("[authService.refresh] User not found for token", { userId });
            throw new error_middleware_1.AppError(401, "User not found", "USER_NOT_FOUND");
        }
        if (user.is_active === false) {
            logger_1.default.warn("[authService.refresh] User is inactive", { userId });
            throw new error_middleware_1.AppError(403, "User is inactive", "USER_INACTIVE");
        }
        const newAccessToken = signAccessToken({ userId: user.id, role: user.role });
        logger_1.default.info("[authService.refresh] New access token issued", { userId });
        return { accessToken: newAccessToken };
    },
    async logout(refreshToken) {
        logger_1.default.info("[authService.logout] Logout requested");
        await auth_repository_1.authRepository.deleteRefreshToken(refreshToken);
        logger_1.default.info("[authService.logout] Refresh token deleted");
        return { message: "Logged out" };
    },
    // ================= EMAIL OTP =================
    // Redis key for pre-registration OTP (user doesn't exist yet)
    _preRegOtpKey(email) {
        return `otp:email:${email}`;
    },
    async sendEmailOtp(emailRaw) {
        const email = String(emailRaw || "").trim().toLowerCase();
        logger_1.default.info("[authService.sendEmailOtp] Start", { email });
        if (!email)
            throw new error_middleware_1.AppError(400, "Email is required", "VALIDATION_ERROR");
        const otp = (0, otp_util_1.generateOtp)();
        const otpHash = await (0, otp_util_1.hashOtp)(otp);
        const user = await auth_repository_1.authRepository.findUserByEmail(email);
        if (user) {
            // Existing user: store OTP in the DB (original flow)
            logger_1.default.info("[authService.sendEmailOtp] Existing user — saving OTP to DB", { userId: user.id });
            await auth_repository_1.authRepository.createOtpVerification({
                user_id: user.id,
                otp_code: otpHash,
                purpose: "email_verification",
                expires_at: (0, otp_util_1.otpExpiry)(10),
            });
        }
        else {
            // Pre-registration: store OTP hash in Redis keyed by email (10 min TTL)
            logger_1.default.info("[authService.sendEmailOtp] Pre-registration — saving OTP to Redis", { email });
            await redis_1.default.set(this._preRegOtpKey(email), otpHash, "EX", 10 * 60);
        }
        logger_1.default.info("[authService.sendEmailOtp] Sending OTP email", { email });
        try {
            await email_service_1.emailService.sendOtpEmail(email, otp);
            logger_1.default.info("[authService.sendEmailOtp] Email sent successfully", { email });
        }
        catch (emailErr) {
            logger_1.default.error("[authService.sendEmailOtp] Failed to send email", {
                email,
                error: emailErr?.message,
                stack: emailErr?.stack,
            });
            throw new error_middleware_1.AppError(500, "Failed to send OTP email", "EMAIL_SEND_FAILED");
        }
        return { message: "OTP sent to email" };
    },
    async verifyEmailOtp(emailRaw, otpRaw) {
        const email = String(emailRaw || "").trim().toLowerCase();
        const otp = String(otpRaw || "").trim();
        logger_1.default.info("[authService.verifyEmailOtp] Start", { email });
        if (!email || !otp)
            throw new error_middleware_1.AppError(400, "Email and OTP required", "VALIDATION_ERROR");
        const user = await auth_repository_1.authRepository.findUserByEmail(email);
        if (!user) {
            // Pre-registration flow: verify against Redis
            logger_1.default.info("[authService.verifyEmailOtp] Pre-registration — checking OTP from Redis", { email });
            const storedHash = await redis_1.default.get(this._preRegOtpKey(email));
            if (!storedHash) {
                logger_1.default.warn("[authService.verifyEmailOtp] Redis OTP not found or expired", { email });
                throw new error_middleware_1.AppError(400, "OTP not found or expired", "OTP_NOT_FOUND");
            }
            const ok = await (0, otp_util_1.compareOtp)(otp, storedHash);
            if (!ok) {
                logger_1.default.warn("[authService.verifyEmailOtp] OTP mismatch (pre-registration)", { email });
                throw new error_middleware_1.AppError(400, "Invalid OTP", "OTP_INVALID");
            }
            // Mark it used by deleting from Redis
            await redis_1.default.del(this._preRegOtpKey(email));
            // Store a verified marker so register endpoint can confirm email was verified
            await redis_1.default.set(`otp:email:verified:${email}`, "1", "EX", 30 * 60);
            logger_1.default.info("[authService.verifyEmailOtp] Pre-registration email verified", { email });
            return { message: "Email verified successfully", success: true };
        }
        // Existing user: check DB (original flow)
        const latest = await auth_repository_1.authRepository.findLatestOtp(user.id, "email_verification");
        if (!latest) {
            logger_1.default.warn("[authService.verifyEmailOtp] No OTP record found", { userId: user.id });
            throw new error_middleware_1.AppError(400, "OTP not found", "OTP_NOT_FOUND");
        }
        if (latest.is_used) {
            logger_1.default.warn("[authService.verifyEmailOtp] OTP already used", { userId: user.id, otpId: latest.id });
            throw new error_middleware_1.AppError(400, "OTP already used", "OTP_USED");
        }
        if (new Date(latest.expires_at).getTime() < Date.now()) {
            logger_1.default.warn("[authService.verifyEmailOtp] OTP expired", { userId: user.id, expiresAt: latest.expires_at });
            throw new error_middleware_1.AppError(400, "OTP expired", "OTP_EXPIRED");
        }
        const ok = await (0, otp_util_1.compareOtp)(otp, latest.otp_code);
        if (!ok) {
            logger_1.default.warn("[authService.verifyEmailOtp] OTP mismatch", { userId: user.id });
            throw new error_middleware_1.AppError(400, "Invalid OTP", "OTP_INVALID");
        }
        await auth_repository_1.authRepository.markOtpUsed(latest.id);
        await auth_repository_1.authRepository.markUserVerified(user.id);
        logger_1.default.info("[authService.verifyEmailOtp] Email verified successfully", { email, userId: user.id });
        return { message: "Email verified successfully", success: true };
    },
    // ================= EXOTEL PHONE OTP =================
    async sendPhoneOtpExotel(emailRaw, phoneRaw) {
        const email = String(emailRaw || "").trim().toLowerCase();
        const phone = String(phoneRaw || "").trim();
        logger_1.default.info("[authService.sendPhoneOtpExotel] Start", { email, phone });
        if (!email || !phone)
            throw new error_middleware_1.AppError(400, "Email and phone required", "VALIDATION_ERROR");
        if (!phone.startsWith("+"))
            throw new error_middleware_1.AppError(400, "Phone must be E.164 format (+91...)", "VALIDATION_ERROR");
        const user = await auth_repository_1.authRepository.findUserByEmail(email);
        if (!user) {
            logger_1.default.warn("[authService.sendPhoneOtpExotel] User not found", { email });
            throw new error_middleware_1.AppError(404, "User not found", "USER_NOT_FOUND");
        }
        logger_1.default.info("[authService.sendPhoneOtpExotel] Calling Exotel API", { phone, userId: user.id });
        let exotelResp;
        try {
            exotelResp = await (0, exotel_service_1.exotelSendSmsOtp)(phone);
            logger_1.default.info("[authService.sendPhoneOtpExotel] Exotel API response", { resp: JSON.stringify(exotelResp) });
        }
        catch (exoErr) {
            logger_1.default.error("[authService.sendPhoneOtpExotel] Exotel API call failed", {
                phone,
                userId: user.id,
                error: exoErr?.message,
                statusCode: exoErr?.statusCode,
                code: exoErr?.code,
            });
            throw new error_middleware_1.AppError(exoErr?.statusCode || 502, exoErr?.message || "Exotel API error", "EXOTEL_ERROR");
        }
        const verificationId = exotelResp?.response?.data?.verification_id ||
            exotelResp?.data?.verification_id ||
            exotelResp?.verification_id;
        if (!verificationId) {
            logger_1.default.error("[authService.sendPhoneOtpExotel] verification_id missing in Exotel response", {
                resp: JSON.stringify(exotelResp),
            });
            throw new error_middleware_1.AppError(500, "Exotel verification_id missing", "EXOTEL_ERROR");
        }
        logger_1.default.info("[authService.sendPhoneOtpExotel] Saving verificationId to DB", { verificationId, userId: user.id });
        await auth_repository_1.authRepository.createOtpVerification({
            user_id: user.id,
            otp_code: String(verificationId),
            purpose: "phone_verification_exotel",
            expires_at: (0, otp_util_1.otpExpiry)(10),
        });
        logger_1.default.info("[authService.sendPhoneOtpExotel] Done", { email, verificationId });
        return { message: "OTP sent to phone", verificationId };
    },
    async verifyPhoneOtpExotel(emailRaw, otpRaw) {
        const email = String(emailRaw || "").trim().toLowerCase();
        const otp = String(otpRaw || "").trim();
        logger_1.default.info("[authService.verifyPhoneOtpExotel] Start", { email });
        if (!email || !otp)
            throw new error_middleware_1.AppError(400, "Email and OTP required", "VALIDATION_ERROR");
        const user = await auth_repository_1.authRepository.findUserByEmail(email);
        if (!user) {
            logger_1.default.warn("[authService.verifyPhoneOtpExotel] User not found", { email });
            throw new error_middleware_1.AppError(404, "User not found", "USER_NOT_FOUND");
        }
        const latest = await auth_repository_1.authRepository.findLatestOtp(user.id, "phone_verification_exotel");
        if (!latest) {
            logger_1.default.warn("[authService.verifyPhoneOtpExotel] No OTP record found", { userId: user.id });
            throw new error_middleware_1.AppError(400, "OTP request not found", "OTP_NOT_FOUND");
        }
        if (latest.is_used) {
            logger_1.default.warn("[authService.verifyPhoneOtpExotel] OTP already used", { userId: user.id });
            throw new error_middleware_1.AppError(400, "OTP already used", "OTP_USED");
        }
        if (new Date(latest.expires_at).getTime() < Date.now()) {
            logger_1.default.warn("[authService.verifyPhoneOtpExotel] OTP expired", { userId: user.id, expiresAt: latest.expires_at });
            throw new error_middleware_1.AppError(400, "OTP expired", "OTP_EXPIRED");
        }
        const verificationId = String(latest.otp_code);
        logger_1.default.info("[authService.verifyPhoneOtpExotel] Calling Exotel verify API", { verificationId });
        let verifyResp;
        try {
            verifyResp = await (0, exotel_service_1.exotelVerifySmsOtp)(verificationId, otp);
            logger_1.default.info("[authService.verifyPhoneOtpExotel] Exotel verify response", { resp: JSON.stringify(verifyResp) });
        }
        catch (exoErr) {
            logger_1.default.error("[authService.verifyPhoneOtpExotel] Exotel verify API failed", {
                verificationId,
                userId: user.id,
                error: exoErr?.message,
                statusCode: exoErr?.statusCode,
            });
            throw new error_middleware_1.AppError(exoErr?.statusCode || 502, exoErr?.message || "Exotel verify failed", "EXOTEL_ERROR");
        }
        const verified = verifyResp?.response?.status === "success" ||
            verifyResp?.response?.data?.status === "success" ||
            verifyResp?.status === "success";
        if (!verified) {
            logger_1.default.warn("[authService.verifyPhoneOtpExotel] OTP invalid or not verified", {
                userId: user.id,
                verifyResp: JSON.stringify(verifyResp),
            });
            throw new error_middleware_1.AppError(400, "Invalid OTP", "OTP_INVALID");
        }
        await auth_repository_1.authRepository.markOtpUsed(latest.id);
        await auth_repository_1.authRepository.markUserVerified(user.id);
        logger_1.default.info("[authService.verifyPhoneOtpExotel] Phone verified successfully", { email, userId: user.id });
        return { message: "Phone verified successfully" };
    },
    // ================= GOOGLE OAUTH =================
    async googleCreateState(payload) {
        const state = randomString(24);
        const full = { ...payload, createdAt: Date.now() };
        await redis_1.default.set(`${STATE_PREFIX}${state}`, JSON.stringify(full), "EX", STATE_TTL_SECONDS);
        return state;
    },
    async googleConsumeState(state) {
        const key = `${STATE_PREFIX}${state}`;
        const raw = await redis_1.default.get(key);
        if (!raw)
            return null;
        await redis_1.default.del(key);
        return JSON.parse(raw);
    },
    googleAuthUrl(params) {
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
        url.searchParams.set("redirect_uri", process.env.GOOGLE_REDIRECT_URI || "");
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", "openid email profile");
        url.searchParams.set("state", params.state);
        url.searchParams.set("code_challenge", params.codeChallenge);
        url.searchParams.set("code_challenge_method", "S256");
        url.searchParams.set("access_type", "offline");
        url.searchParams.set("prompt", "consent");
        return url.toString();
    },
    async googleExchangeCode(code, codeVerifier) {
        const res = await axios_1.default.post("https://oauth2.googleapis.com/token", new URLSearchParams({
            code,
            client_id: process.env.GOOGLE_CLIENT_ID || "",
            client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
            redirect_uri: process.env.GOOGLE_REDIRECT_URI || "",
            grant_type: "authorization_code",
            code_verifier: codeVerifier,
        }).toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        return res.data;
    },
    async googleGetProfile(accessToken) {
        const userRes = await axios_1.default.get("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const u = userRes.data;
        return {
            provider: "google",
            providerUserId: String(u.sub),
            email: u.email ?? null,
            fullName: u.name ?? null,
            avatarUrl: u.picture ?? null,
            emailVerified: !!u.email_verified,
        };
    },
    async signInWithGoogle(profile) {
        const existing = await auth_repository_1.authRepository.findGoogleIdentity(profile.providerUserId);
        let user;
        if (existing?.id) {
            user = await auth_repository_1.authRepository.updateUserBasics(existing.id, profile);
        }
        else if (profile.email) {
            const byEmail = await auth_repository_1.authRepository.findUserByEmail(profile.email);
            if (byEmail) {
                user = await auth_repository_1.authRepository.updateUserBasics(byEmail.id, profile);
                await auth_repository_1.authRepository.attachGoogleIdentity(user.id, profile);
            }
            else {
                user = await auth_repository_1.authRepository.createUserFromGoogle(profile);
                await auth_repository_1.authRepository.attachGoogleIdentity(user.id, profile);
            }
        }
        else {
            user = await auth_repository_1.authRepository.createUserFromGoogle(profile);
            await auth_repository_1.authRepository.attachGoogleIdentity(user.id, profile);
        }
        const accessToken = signAccessToken({ userId: user.id, role: user.role });
        const refreshToken = signRefreshToken({ userId: user.id });
        await auth_repository_1.authRepository.saveRefreshToken({
            user_id: user.id,
            token: refreshToken,
            expires_at: refreshExpiryDate(),
        });
        return { user, accessToken, refreshToken };
    },
    googleMakePkce() {
        const codeVerifier = randomString(32);
        const codeChallenge = sha256Base64Url(codeVerifier);
        return { codeVerifier, codeChallenge };
    },
};
//# sourceMappingURL=auth.service.js.map