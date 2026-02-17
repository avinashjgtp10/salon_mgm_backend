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
  // keep same as your DB expires_at logic (30 days)
  const days = 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export const authService = {
  async register(body: RegisterBody) {
    assertEnv();

    const existing = await authRepository.findUserByEmail(body.email);
    if (existing)
      throw new AppError(409, "Email already exists", "EMAIL_EXISTS");

    const password_hash = await bcrypt.hash(body.password, 10);

    const user = await authRepository.createUser({
      email: body.email,
      phone: body.phone ?? null,
      password_hash,
      first_name: body.first_name,
      last_name: body.last_name ?? null,
      role: body.role,
    });

    return user;
  },

  async login(body: LoginBody) {
    assertEnv();

    const user = await authRepository.findUserByEmail(body.email);
    if (!user)
      throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");

    if (user.is_active === false) {
      throw new AppError(403, "User is inactive", "USER_INACTIVE");
    }

    const ok = await bcrypt.compare(body.password, user.password_hash);
    if (!ok)
      throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");

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
    if (!saved)
      throw new AppError(401, "Invalid refresh token", "INVALID_REFRESH");

    // DB expiry check
    if (new Date(saved.expires_at).getTime() < Date.now()) {
      await authRepository.deleteRefreshToken(refreshToken);
      throw new AppError(401, "Refresh token expired", "REFRESH_EXPIRED");
    }

    // JWT verify
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

    const newAccessToken = signAccessToken({
      userId: user.id,
      role: user.role,
    });

    return { accessToken: newAccessToken };
  },

  async logout(refreshToken: string) {
    await authRepository.deleteRefreshToken(refreshToken);
    return { message: "Logged out" };
  },
};
