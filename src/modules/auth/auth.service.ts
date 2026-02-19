
import bcrypt from "bcrypt";
import jwt, { Secret, SignOptions } from "jsonwebtoken";
import { AppError } from "../../middleware/error.middleware";
import { authRepository } from "./auth.repository";
import type { RegisterBody, LoginBody } from "./auth.types";

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

function signAccessToken(payload: { userId: string; role: string }) {
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

export const authService = {
  async register(body: RegisterBody) {
    assertEnv();

    const email = String(body.email || "").trim().toLowerCase();
    if (!email) throw new AppError(400, "Email is required", "VALIDATION_ERROR");
    if (!body.password) throw new AppError(400, "Password is required", "VALIDATION_ERROR");
    if (!body.fullName?.trim()) throw new AppError(400, "Full name is required", "VALIDATION_ERROR");

    // ✅ Terms required
    if (body.terms !== true) {
      throw new AppError(400, "Terms must be accepted", "TERMS_NOT_ACCEPTED");
    }

    const existing = await authRepository.findUserByEmail(email);
    if (existing) throw new AppError(409, "Email already exists", "EMAIL_EXISTS");

    const { first_name, last_name } = splitFullName(body.fullName);

    const password_hash = await bcrypt.hash(body.password, 10);

    // ✅ SECURITY: do NOT accept role from frontend
    // Example rule: if businessName present => salon_owner else client
    const role = body.businessName?.trim() ? "salon_owner" : "client";

    /**
     * OPTION A (Recommended): If your users table has extra columns:
     * business_name, address, country, country_code, phone
     * then pass them to createUser.
     *
     * OPTION B: If your createUser does NOT support these fields,
     * remove them from the object.
     */
    const user = await authRepository.createUser({
      email,
      phone: body.phone?.trim() ? body.phone.trim() : null,
      password_hash,
      first_name,
      last_name,
      role,

      // ✅ include ONLY if your repository + DB supports these columns
      business_name: body.businessName?.trim() ? body.businessName.trim() : null,
      address: body.address?.trim() ? body.address.trim() : null,
      country: body.country?.trim() ? body.country.trim() : null,
      country_code: body.countryCode?.trim() ? body.countryCode.trim() : null,
    } as any);

    return user;
  },

  async login(body: LoginBody) {
    assertEnv();

    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    const user = await authRepository.findUserByEmail(email);
    if (!user) throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");

    if (user.is_active === false) {
      throw new AppError(403, "User is inactive", "USER_INACTIVE");
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");

    await authRepository.updateLastLogin(user.id);

    const accessToken = signAccessToken({ userId: user.id, role: user.role });
    const refreshToken = signRefreshToken({ userId: user.id });

    await authRepository.saveRefreshToken({
      user_id: user.id,
      token: refreshToken,
      expires_at: refreshExpiryDate(),
    });

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

  async refresh(refreshToken: string) {
    assertEnv();

    const saved = await authRepository.findRefreshToken(refreshToken);
    if (!saved) throw new AppError(401, "Invalid refresh token", "INVALID_REFRESH");

    if (new Date(saved.expires_at).getTime() < Date.now()) {
      await authRepository.deleteRefreshToken(refreshToken);
      throw new AppError(401, "Refresh token expired", "REFRESH_EXPIRED");
    }

    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, REFRESH_SECRET);
    } catch {
      throw new AppError(401, "Invalid refresh token", "INVALID_REFRESH");
    }

    const userId = decoded.userId as string;

    const user = await authRepository.findUserById(userId);
    if (!user) throw new AppError(401, "User not found", "USER_NOT_FOUND");

    if (user.is_active === false) {
      throw new AppError(403, "User is inactive", "USER_INACTIVE");
    }

    const newAccessToken = signAccessToken({ userId: user.id, role: user.role });
    return { accessToken: newAccessToken };
  },

  async logout(refreshToken: string) {
    await authRepository.deleteRefreshToken(refreshToken);
    return { message: "Logged out" };
  },
};

