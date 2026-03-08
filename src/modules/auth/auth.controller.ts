import { Request, Response, NextFunction } from "express";
import { authService } from "./auth.service";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import {
  recordLoginFail,
  resetLoginFails,
} from "../../middleware/rate-limit.middleware";
import logger from "../../config/logger";
import { googleStartQuerySchema } from "./auth.validator";

function redirectToFrontend(res: Response, accessToken: string, refreshToken: string, returnTo?: string) {
  // Try mapping frontend from env based on typical setups, fallback if missing
  const frontendUrl = process.env.APP_BASE_URL || process.env.FRONTEND_URL || "http://localhost:5173";
  const base = new URL(frontendUrl);
  base.pathname = "/oauth/success";
  base.searchParams.set("token", accessToken);
  base.searchParams.set("refreshToken", refreshToken); // Included just in case the client needs it
  if (returnTo) base.searchParams.set("returnTo", returnTo);
  res.redirect(base.toString());
}

export const authController = {

  // ================= REGISTER =================
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body;

      logger.info("Register request received", {
        email: body?.email,
        ip: req.ip,
      });

      // ✅ Validate required fields (NEW STRUCTURE)
      if (!body?.email || !body?.password || !body?.fullName) {
        logger.warn("Register validation failed", { body });
        throw new AppError(400, "Missing required fields", "VALIDATION_ERROR");
      }

      // ✅ Terms required
      if (body?.terms !== true) {
        throw new AppError(
          400,
          "Terms must be accepted",
          "TERMS_NOT_ACCEPTED"
        );
      }

      const user = await authService.register(body);

      logger.info("User registered successfully", { email: body.email });

      return sendSuccess(res, 201, user, "User registered successfully");
    } catch (error) {
      logger.error("Register error", { error });
      return next(error);
    }
  },

  // ================= LOGIN =================
  async login(req: Request, res: Response, next: NextFunction) {
    const email = String(req.body?.email || "")
      .toLowerCase()
      .trim();
    const password = String(req.body?.password || "");
    const ip = String((req as any).ip || "");

    try {
      logger.info("Login attempt", { email, ip });

      if (!email || !password) {
        logger.warn("Login validation failed", { email });
        throw new AppError(
          400,
          "Email and password required",
          "VALIDATION_ERROR"
        );
      }

      const data = await authService.login({ email, password });

      await resetLoginFails(email, ip);

      logger.info("Login successful", { email, ip });

      return sendSuccess(res, 200, data, "Login successful");
    } catch (error: any) {

      // ✅ Rate limit handling
      if (
        error instanceof AppError &&
        error.code === "INVALID_CREDENTIALS"
      ) {
        logger.warn("Invalid login credentials", { email, ip });

        try {
          const r = await recordLoginFail(email, ip);
          const left = Math.max(0, 3 - r.consumedPoints);

          return next(
            new AppError(
              401,
              `Invalid credentials. Attempts left: ${left}`,
              "INVALID_CREDENTIALS"
            )
          );
        } catch (e: any) {

          if (e?.msBeforeNext) {
            logger.warn("Login rate limit exceeded", { email, ip });

            return next(
              new AppError(
                429,
                `Too many failed attempts. Try again in ${Math.ceil(
                  e.msBeforeNext / 1000
                )} seconds.`,
                "RATE_LIMIT"
              )
            );
          }
        }
      }

      logger.error("Login error", { error, email, ip });
      return next(error);
    }
  },

  // ================= REFRESH TOKEN =================
  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const refreshToken = String(req.body?.refreshToken || "");

      logger.info("Token refresh request", { ip: req.ip });

      if (!refreshToken) {
        throw new AppError(
          400,
          "refreshToken required",
          "VALIDATION_ERROR"
        );
      }

      const data = await authService.refresh(refreshToken);

      logger.info("Token refreshed successfully");

      return sendSuccess(
        res,
        200,
        data,
        "Token refreshed successfully"
      );
    } catch (error) {
      logger.error("Refresh token error", { error });
      return next(error);
    }
  },

  // ================= LOGOUT =================
  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const refreshToken = String(req.body?.refreshToken || "");

      logger.info("Logout request received", { ip: req.ip });

      if (!refreshToken) {
        throw new AppError(
          400,
          "refreshToken required",
          "VALIDATION_ERROR"
        );
      }

      const data = await authService.logout(refreshToken);

      logger.info("User logged out successfully");

      return sendSuccess(res, 200, data, "Logged out successfully");
    } catch (error) {
      logger.error("Logout error", { error });
      return next(error);
    }
  },

  // ================= EMAIL OTP =================
  async sendEmailOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const data = await authService.sendEmailOtp(email);
      return sendSuccess(res, 200, data, "OTP sent");
    } catch (e) {
      return next(e);
    }
  },

  async verifyEmailOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const otp = String(req.body?.otp || "").trim();
      const data = await authService.verifyEmailOtp(email, otp);
      return sendSuccess(res, 200, data, "Email verified");
    } catch (e) {
      return next(e);
    }
  },

  // ================= EXOTEL PHONE OTP =================
  async sendPhoneOtpExotel(req: Request, res: Response, next: NextFunction) {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const phone = String(req.body?.phone || "").trim();
      const data = await authService.sendPhoneOtpExotel(email, phone);
      return sendSuccess(res, 200, data, "Phone OTP sent");
    } catch (e) {
      return next(e);
    }
  },

  async verifyPhoneOtpExotel(req: Request, res: Response, next: NextFunction) {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const otp = String(req.body?.otp || "").trim();
      const data = await authService.verifyPhoneOtpExotel(email, otp);
      return sendSuccess(res, 200, data, "Phone verified");
    } catch (e) {
      return next(e);
    }
  },

  // ================= GOOGLE OAUTH =================

  async googleStart(req: Request, res: Response, next: NextFunction) {
    try {
      const q = googleStartQuerySchema.parse(req.query);
      const returnTo = q.returnTo;

      const { codeVerifier, codeChallenge } = authService.googleMakePkce();

      const state = await authService.googleCreateState({ codeVerifier, returnTo });

      const url = authService.googleAuthUrl({ state, codeChallenge });
      return res.redirect(url);
    } catch (e) {
      logger.error("googleStart error", { error: e });
      next(e);
    }
  },

  async googleCallback(req: Request, res: Response, _next: NextFunction) {
    try {
      const code = String(req.query.code || "");
      const state = String(req.query.state || "");

      if (!code || !state) {
        return res.status(400).json({ message: "Missing code/state. Do not open callback directly." });
      }

      // We explicitly skip zod here so we can see real errors 
      // instead of validation errors on direct access

      const st = await authService.googleConsumeState(state);
      if (!st?.codeVerifier) {
        return res.status(400).json({ message: "Invalid/expired state. Try logging in again." });
      }

      const tokens = await authService.googleExchangeCode(code, st.codeVerifier);
      const profile = await authService.googleGetProfile(tokens.access_token);

      const { accessToken, refreshToken } = await authService.signInWithGoogle(profile);

      // We redirect directly to frontend and pass the token(s) instead of cookies
      return redirectToFrontend(res, accessToken, refreshToken, st.returnTo);
    } catch (err: any) {
      console.error("GOOGLE CALLBACK ERROR:", err?.response?.data || err?.message || err);
      // Send JSON so the browser shows exactly what went wrong
      return res.status(500).json({
        message: "Google callback failed",
        detail: err?.response?.data || err?.message || String(err)
      });
    }
  },
};
