
import bcrypt from "bcrypt";
import jwt, { Secret, SignOptions } from "jsonwebtoken";
import { AppError } from "../../middleware/error.middleware";
import { authRepository } from "./auth.repository";
import type { RegisterBody, LoginBody } from "./auth.types";
import { generateOtp, hashOtp, compareOtp, otpExpiry } from "../utils/otp.util";
import { emailService } from "../utils/email.service";
import { exotelSendSmsOtp, exotelVerifySmsOtp } from "../utils/exotel.service";
import logger from "../../config/logger";
import crypto from "crypto";
import axios from "axios";
import redis from "../../config/redis";
import type { GoogleOAuthProfile, GoogleStatePayload } from "./auth.types";


const ACCESS_SECRET: Secret = process.env.JWT_ACCESS_SECRET || "";
const REFRESH_SECRET: Secret = process.env.JWT_REFRESH_SECRET || "";

const accessOptions: SignOptions = {
  expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || "15m") as any,
};

const refreshOptions: SignOptions = {
  expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || "30d") as any,
};

function assertEnv() {
  if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
    throw new Error("JWT secrets missing in env");
  }
}

function signAccessToken(payload: { userId: string; role: string; salonId?: string | null }) {
  return jwt.sign(payload, ACCESS_SECRET, accessOptions);
}

function signRefreshToken(payload: { userId: string }) {
  return jwt.sign(payload, REFRESH_SECRET, refreshOptions);
}

function refreshExpiryDate(): Date {
  const days = 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function splitFullName(fullName: string) {
  const name = String(fullName || "").trim().replace(/\s+/g, " ");
  if (!name) return { first_name: "", last_name: null as string | null };

  const parts = name.split(" ");
  const first_name = parts[0];
  const last_name = parts.length > 1 ? parts.slice(1).join(" ") : null;

  return { first_name, last_name };
}

const STATE_PREFIX = "google:state:";
const STATE_TTL_SECONDS = 10 * 60;

function base64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomString(bytes = 32) {
  return base64url(crypto.randomBytes(bytes));
}

function sha256Base64Url(input: string) {
  const hash = crypto.createHash("sha256").update(input).digest();
  return base64url(hash);
}

export const authService = {
  async register(body: RegisterBody) {
    logger.info("[authService.register] Start", { email: body?.email });
    assertEnv();

    const email = String(body.email || "").trim().toLowerCase();
    if (!email) throw new AppError(400, "Email is required", "VALIDATION_ERROR");
    if (!body.password) throw new AppError(400, "Password is required", "VALIDATION_ERROR");
    if (!body.fullName?.trim()) throw new AppError(400, "Full name is required", "VALIDATION_ERROR");

    if (body.terms !== true) {
      logger.warn("[authService.register] Terms not accepted", { email });
      throw new AppError(400, "Terms must be accepted", "TERMS_NOT_ACCEPTED");
    }

    const existing = await authRepository.findUserByEmail(email);
    if (existing) {
      logger.warn("[authService.register] Email already exists", { email });
      throw new AppError(409, "Email already exists", "EMAIL_EXISTS");
    }

    const { first_name, last_name } = splitFullName(body.fullName);
    const password_hash = await bcrypt.hash(body.password, 10);
    const role = body.businessName?.trim() ? "salon_owner" : "client";

    logger.info("[authService.register] Creating user", { email, role });

    const user = await authRepository.createUser({
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
    } as any);

    const salonId = await authRepository.findSalonIdByUserId(user.id);
    const accessToken = signAccessToken({ userId: user.id, role: user.role, salonId });
    const refreshToken = signRefreshToken({ userId: user.id });

    await authRepository.saveRefreshToken({
      user_id: user.id,
      token: refreshToken,
      expires_at: refreshExpiryDate(),
    });

    logger.info("[authService.register] User created successfully", { email, userId: user?.id, role, salonId });

    return {
      accessToken,
      refreshToken,
      isOnboardingComplete: false,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
        salonId,
      },
    };
  },

  async login(body: LoginBody) {
    logger.info("[authService.login] Start", { email: body?.email });
    assertEnv();

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      logger.warn("[authService.login] User not found", { email });
      throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");
    }

    if (user.is_active === false) {
      logger.warn("[authService.login] User is inactive", { email, userId: user.id });
      throw new AppError(403, "User is inactive", "USER_INACTIVE");
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      logger.warn("[authService.login] Wrong password", { email });
      throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");
    }

    await authRepository.updateLastLogin(user.id);

    const salonId = await authRepository.findSalonIdByUserId(user.id);
    const accessToken = signAccessToken({ userId: user.id, role: user.role, salonId });
    const refreshToken = signRefreshToken({ userId: user.id });

    await authRepository.saveRefreshToken({
      user_id: user.id,
      token: refreshToken,
      expires_at: refreshExpiryDate(),
    });

    logger.info("[authService.login] Login successful", { email, userId: user.id, role: user.role, salonId });

    return {
      accessToken,
      refreshToken,
      isOnboardingComplete: user.is_onboarding_complete ?? false,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
        salonId,
      },
    };
  },

  async refresh(refreshToken: string) {
    logger.info("[authService.refresh] Token refresh requested");
    assertEnv();

    const saved = await authRepository.findRefreshToken(refreshToken);
    if (!saved) {
      logger.warn("[authService.refresh] Refresh token not found in DB");
      throw new AppError(401, "Invalid refresh token", "INVALID_REFRESH");
    }

    if (new Date(saved.expires_at).getTime() < Date.now()) {
      logger.warn("[authService.refresh] Refresh token expired", { userId: saved.user_id });
      await authRepository.deleteRefreshToken(refreshToken);
      throw new AppError(401, "Refresh token expired", "REFRESH_EXPIRED");
    }

    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, REFRESH_SECRET);
    } catch (jwtErr: any) {
      logger.error("[authService.refresh] JWT verify failed", { error: jwtErr.message });
      throw new AppError(401, "Invalid refresh token", "INVALID_REFRESH");
    }

    const userId = decoded.userId as string;

    const user = await authRepository.findUserById(userId);
    if (!user) {
      logger.warn("[authService.refresh] User not found for token", { userId });
      throw new AppError(401, "User not found", "USER_NOT_FOUND");
    }

    if (user.is_active === false) {
      logger.warn("[authService.refresh] User is inactive", { userId });
      throw new AppError(403, "User is inactive", "USER_INACTIVE");
    }

    const salonId = await authRepository.findSalonIdByUserId(user.id);
    const newAccessToken = signAccessToken({ userId: user.id, role: user.role, salonId });
    logger.info("[authService.refresh] New access token issued", { userId, salonId });
    return { accessToken: newAccessToken };
  },

  async logout(refreshToken: string) {
    logger.info("[authService.logout] Logout requested");
    await authRepository.deleteRefreshToken(refreshToken);
    logger.info("[authService.logout] Refresh token deleted");
    return { message: "Logged out" };
  },

  // ================= EMAIL OTP =================

  // Redis key for pre-registration OTP (user doesn't exist yet)
  _preRegOtpKey(email: string) {
    return `otp:email:${email}`;
  },

  async sendEmailOtp(emailRaw: string) {
    const email = String(emailRaw || "").trim().toLowerCase();
    logger.info("[authService.sendEmailOtp] Start", { email });

    if (!email) throw new AppError(400, "Email is required", "VALIDATION_ERROR");

    const otp = generateOtp();
    const otpHash = await hashOtp(otp);

    const user = await authRepository.findUserByEmail(email);

    if (user) {
      // Existing user: store OTP in the DB (original flow)
      logger.info("[authService.sendEmailOtp] Existing user — saving OTP to DB", { userId: user.id });
      await authRepository.createOtpVerification({
        user_id: user.id,
        otp_code: otpHash,
        purpose: "email_verification",
        expires_at: otpExpiry(10),
      });
    } else {
      // Pre-registration: store OTP hash in Redis keyed by email (10 min TTL)
      logger.info("[authService.sendEmailOtp] Pre-registration — saving OTP to Redis", { email });
      await redis.set(this._preRegOtpKey(email), otpHash, "EX", 10 * 60);
    }

    logger.info("[authService.sendEmailOtp] Sending OTP email", { email });
    try {
      await emailService.sendOtpEmail(email, otp);
      logger.info("[authService.sendEmailOtp] Email sent successfully", { email });
    } catch (emailErr: any) {
      logger.error("[authService.sendEmailOtp] Failed to send email", {
        email,
        error: emailErr?.message,
        stack: emailErr?.stack,
      });
      throw new AppError(500, "Failed to send OTP email", "EMAIL_SEND_FAILED");
    }

    return { message: "OTP sent to email" };
  },

  async verifyEmailOtp(emailRaw: string, otpRaw: string) {
    const email = String(emailRaw || "").trim().toLowerCase();
    const otp = String(otpRaw || "").trim();
    logger.info("[authService.verifyEmailOtp] Start", { email });

    if (!email || !otp) throw new AppError(400, "Email and OTP required", "VALIDATION_ERROR");

    const user = await authRepository.findUserByEmail(email);

    if (!user) {
      // Pre-registration flow: verify against Redis
      logger.info("[authService.verifyEmailOtp] Pre-registration — checking OTP from Redis", { email });
      const storedHash = await redis.get(this._preRegOtpKey(email));
      if (!storedHash) {
        logger.warn("[authService.verifyEmailOtp] Redis OTP not found or expired", { email });
        throw new AppError(400, "OTP not found or expired", "OTP_NOT_FOUND");
      }

      const ok = await compareOtp(otp, storedHash);
      if (!ok) {
        logger.warn("[authService.verifyEmailOtp] OTP mismatch (pre-registration)", { email });
        throw new AppError(400, "Invalid OTP", "OTP_INVALID");
      }

      // Mark it used by deleting from Redis
      await redis.del(this._preRegOtpKey(email));
      // Store a verified marker so register endpoint can confirm email was verified
      await redis.set(`otp:email:verified:${email}`, "1", "EX", 30 * 60);

      logger.info("[authService.verifyEmailOtp] Pre-registration email verified", { email });
      return { message: "Email verified successfully", success: true };
    }

    // Existing user: check DB (original flow)
    const latest = await authRepository.findLatestOtp(user.id, "email_verification");
    if (!latest) {
      logger.warn("[authService.verifyEmailOtp] No OTP record found", { userId: user.id });
      throw new AppError(400, "OTP not found", "OTP_NOT_FOUND");
    }

    if (latest.is_used) {
      logger.warn("[authService.verifyEmailOtp] OTP already used", { userId: user.id, otpId: latest.id });
      throw new AppError(400, "OTP already used", "OTP_USED");
    }

    if (new Date(latest.expires_at).getTime() < Date.now()) {
      logger.warn("[authService.verifyEmailOtp] OTP expired", { userId: user.id, expiresAt: latest.expires_at });
      throw new AppError(400, "OTP expired", "OTP_EXPIRED");
    }

    const ok = await compareOtp(otp, latest.otp_code);
    if (!ok) {
      logger.warn("[authService.verifyEmailOtp] OTP mismatch", { userId: user.id });
      throw new AppError(400, "Invalid OTP", "OTP_INVALID");
    }

    await authRepository.markOtpUsed(latest.id);
    await authRepository.markUserVerified(user.id);

    logger.info("[authService.verifyEmailOtp] Email verified successfully", { email, userId: user.id });
    return { message: "Email verified successfully", success: true };
  },

  // ================= FORGOT PASSWORD =================
  async forgotPasswordSendOtp(emailRaw: string) {
    const email = String(emailRaw || "").trim().toLowerCase();
    logger.info("[authService.forgotPasswordSendOtp] Start", { email });

    if (!email) throw new AppError(400, "Email is required", "VALIDATION_ERROR");

    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      // Return success anyway to avoid email enumeration attacks
      logger.info("[authService.forgotPasswordSendOtp] User not found, pretending success", { email });
      return { message: "If an account exists, an OTP has been sent." };
    }

    const otp = generateOtp();
    const otpHash = await hashOtp(otp);

    await authRepository.createOtpVerification({
      user_id: user.id,
      otp_code: otpHash,
      purpose: "password_reset",
      expires_at: otpExpiry(10),
    });

    logger.info("[authService.forgotPasswordSendOtp] Sending password reset OTP", { email });
    try {
      await emailService.sendPasswordResetOtpEmail(email, otp);
      logger.info("[authService.forgotPasswordSendOtp] Email sent successfully", { email });
    } catch (emailErr: any) {
      logger.error("[authService.forgotPasswordSendOtp] Failed to send email", {
        email,
        error: emailErr?.message,
      });
      throw new AppError(500, "Failed to send reset email", "EMAIL_SEND_FAILED");
    }

    return { message: "If an account exists, an OTP has been sent." };
  },

  async forgotPasswordVerifyOtp(emailRaw: string, otpRaw: string) {
    const email = String(emailRaw || "").trim().toLowerCase();
    const otp = String(otpRaw || "").trim();
    logger.info("[authService.forgotPasswordVerifyOtp] Start", { email });

    if (!email || !otp) throw new AppError(400, "Email and OTP required", "VALIDATION_ERROR");

    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      throw new AppError(400, "Invalid OTP", "OTP_INVALID");
    }

    const latest = await authRepository.findLatestOtp(user.id, "password_reset");
    if (!latest) {
      throw new AppError(400, "OTP not found", "OTP_NOT_FOUND");
    }

    if (latest.is_used) {
      throw new AppError(400, "OTP already used", "OTP_USED");
    }

    if (new Date(latest.expires_at).getTime() < Date.now()) {
      throw new AppError(400, "OTP expired", "OTP_EXPIRED");
    }

    const ok = await compareOtp(otp, latest.otp_code);
    if (!ok) {
      throw new AppError(400, "Invalid OTP", "OTP_INVALID");
    }

    return { message: "OTP is valid", success: true };
  },

  async resetPassword(emailRaw: string, otpRaw: string, newPasswordRaw: string) {
    const email = String(emailRaw || "").trim().toLowerCase();
    const otp = String(otpRaw || "").trim();
    const newPassword = String(newPasswordRaw || "");
    
    logger.info("[authService.resetPassword] Start", { email });

    if (!email || !otp || !newPassword) {
      throw new AppError(400, "Email, OTP, and new password are required", "VALIDATION_ERROR");
    }

    if (newPassword.length < 8) {
      throw new AppError(400, "Password must be at least 8 characters", "VALIDATION_ERROR");
    }

    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      throw new AppError(400, "Invalid OTP", "OTP_INVALID");
    }

    const latest = await authRepository.findLatestOtp(user.id, "password_reset");
    if (!latest || latest.is_used || new Date(latest.expires_at).getTime() < Date.now()) {
      throw new AppError(400, "OTP invalid or expired", "OTP_INVALID");
    }

    const ok = await compareOtp(otp, latest.otp_code);
    if (!ok) {
      throw new AppError(400, "Invalid OTP", "OTP_INVALID");
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    
    await authRepository.updatePassword(user.id, passwordHash);
    await authRepository.markOtpUsed(latest.id);
    
    // Log out of all sessions for security
    await authRepository.deleteAllRefreshTokensForUser(user.id);

    logger.info("[authService.resetPassword] Password reset successfully", { email, userId: user.id });
    return { message: "Password reset successful" };
  },

  // ================= EXOTEL PHONE OTP =================
  async sendPhoneOtpExotel(emailRaw: string, phoneRaw: string) {
    const email = String(emailRaw || "").trim().toLowerCase();
    const phone = String(phoneRaw || "").trim();
    logger.info("[authService.sendPhoneOtpExotel] Start", { email, phone });

    if (!email || !phone) throw new AppError(400, "Email and phone required", "VALIDATION_ERROR");
    if (!phone.startsWith("+")) throw new AppError(400, "Phone must be E.164 format (+91...)", "VALIDATION_ERROR");

    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      logger.warn("[authService.sendPhoneOtpExotel] User not found", { email });
      throw new AppError(404, "User not found", "USER_NOT_FOUND");
    }

    logger.info("[authService.sendPhoneOtpExotel] Calling Exotel API", { phone, userId: user.id });
    let exotelResp: any;
    try {
      exotelResp = await exotelSendSmsOtp(phone);
      logger.info("[authService.sendPhoneOtpExotel] Exotel API response", { resp: JSON.stringify(exotelResp) });
    } catch (exoErr: any) {
      logger.error("[authService.sendPhoneOtpExotel] Exotel API call failed", {
        phone,
        userId: user.id,
        error: exoErr?.message,
        statusCode: exoErr?.statusCode,
        code: exoErr?.code,
      });
      throw new AppError(
        exoErr?.statusCode || 502,
        exoErr?.message || "Exotel API error",
        "EXOTEL_ERROR"
      );
    }

    const verificationId =
      exotelResp?.response?.data?.verification_id ||
      exotelResp?.data?.verification_id ||
      exotelResp?.verification_id;

    if (!verificationId) {
      logger.error("[authService.sendPhoneOtpExotel] verification_id missing in Exotel response", {
        resp: JSON.stringify(exotelResp),
      });
      throw new AppError(500, "Exotel verification_id missing", "EXOTEL_ERROR");
    }

    logger.info("[authService.sendPhoneOtpExotel] Saving verificationId to DB", { verificationId, userId: user.id });
    await authRepository.createOtpVerification({
      user_id: user.id,
      otp_code: String(verificationId),
      purpose: "phone_verification_exotel",
      expires_at: otpExpiry(10),
    });

    logger.info("[authService.sendPhoneOtpExotel] Done", { email, verificationId });
    return { message: "OTP sent to phone", verificationId };
  },

  async verifyPhoneOtpExotel(emailRaw: string, otpRaw: string) {
    const email = String(emailRaw || "").trim().toLowerCase();
    const otp = String(otpRaw || "").trim();
    logger.info("[authService.verifyPhoneOtpExotel] Start", { email });

    if (!email || !otp) throw new AppError(400, "Email and OTP required", "VALIDATION_ERROR");

    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      logger.warn("[authService.verifyPhoneOtpExotel] User not found", { email });
      throw new AppError(404, "User not found", "USER_NOT_FOUND");
    }

    const latest = await authRepository.findLatestOtp(user.id, "phone_verification_exotel");
    if (!latest) {
      logger.warn("[authService.verifyPhoneOtpExotel] No OTP record found", { userId: user.id });
      throw new AppError(400, "OTP request not found", "OTP_NOT_FOUND");
    }

    if (latest.is_used) {
      logger.warn("[authService.verifyPhoneOtpExotel] OTP already used", { userId: user.id });
      throw new AppError(400, "OTP already used", "OTP_USED");
    }

    if (new Date(latest.expires_at).getTime() < Date.now()) {
      logger.warn("[authService.verifyPhoneOtpExotel] OTP expired", { userId: user.id, expiresAt: latest.expires_at });
      throw new AppError(400, "OTP expired", "OTP_EXPIRED");
    }

    const verificationId = String(latest.otp_code);
    logger.info("[authService.verifyPhoneOtpExotel] Calling Exotel verify API", { verificationId });

    let verifyResp: any;
    try {
      verifyResp = await exotelVerifySmsOtp(verificationId, otp);
      logger.info("[authService.verifyPhoneOtpExotel] Exotel verify response", { resp: JSON.stringify(verifyResp) });
    } catch (exoErr: any) {
      logger.error("[authService.verifyPhoneOtpExotel] Exotel verify API failed", {
        verificationId,
        userId: user.id,
        error: exoErr?.message,
        statusCode: exoErr?.statusCode,
      });
      throw new AppError(
        exoErr?.statusCode || 502,
        exoErr?.message || "Exotel verify failed",
        "EXOTEL_ERROR"
      );
    }

    const verified =
      verifyResp?.response?.status === "success" ||
      verifyResp?.response?.data?.status === "success" ||
      verifyResp?.status === "success";

    if (!verified) {
      logger.warn("[authService.verifyPhoneOtpExotel] OTP invalid or not verified", {
        userId: user.id,
        verifyResp: JSON.stringify(verifyResp),
      });
      throw new AppError(400, "Invalid OTP", "OTP_INVALID");
    }

    await authRepository.markOtpUsed(latest.id);
    await authRepository.markUserVerified(user.id);

    logger.info("[authService.verifyPhoneOtpExotel] Phone verified successfully", { email, userId: user.id });
    return { message: "Phone verified successfully" };
  },

  // ================= GOOGLE OAUTH =================

  async googleCreateState(payload: Omit<GoogleStatePayload, "createdAt">) {
    const state = randomString(24);
    const full: GoogleStatePayload = { ...payload, createdAt: Date.now() };
    await redis.set(`${STATE_PREFIX}${state}`, JSON.stringify(full), "EX", STATE_TTL_SECONDS);
    return state;
  },

  async googleConsumeState(state: string) {
    const key = `${STATE_PREFIX}${state}`;
    const raw = await redis.get(key);
    if (!raw) return null;
    await redis.del(key);
    return JSON.parse(raw) as GoogleStatePayload;
  },

  googleAuthUrl(params: { state: string; codeChallenge: string }) {
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

  async googleExchangeCode(code: string, codeVerifier: string) {
    const res = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: process.env.GOOGLE_REDIRECT_URI || "",
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    return res.data as { access_token: string; id_token: string };
  },

  async googleGetProfile(accessToken: string): Promise<GoogleOAuthProfile> {
    const userRes = await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
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

  async signInWithGoogle(profile: GoogleOAuthProfile) {
    const existing = await authRepository.findGoogleIdentity(profile.providerUserId);
    let user: any;

    if (existing?.id) {
      user = await authRepository.updateUserBasics(existing.id, profile);
    } else if (profile.email) {
      const byEmail = await authRepository.findUserByEmail(profile.email);
      if (byEmail) {
        user = await authRepository.updateUserBasics(byEmail.id, profile);
        await authRepository.attachGoogleIdentity(user.id, profile);
      } else {
        user = await authRepository.createUserFromGoogle(profile);
        await authRepository.attachGoogleIdentity(user.id, profile);
      }
    } else {
      user = await authRepository.createUserFromGoogle(profile);
      await authRepository.attachGoogleIdentity(user.id, profile);
    }

    const salonId = await authRepository.findSalonIdByUserId(user.id);
    const accessToken = signAccessToken({ userId: user.id, role: user.role, salonId });
    const refreshToken = signRefreshToken({ userId: user.id });

    await authRepository.saveRefreshToken({
      user_id: user.id,
      token: refreshToken,
      expires_at: refreshExpiryDate(),
    });

    return { user, accessToken, refreshToken, salonId, isOnboardingComplete: user.is_onboarding_complete ?? false };
  },

  googleMakePkce() {
    const codeVerifier = randomString(32);
    const codeChallenge = sha256Base64Url(codeVerifier);
    return { codeVerifier, codeChallenge };
  },
};

