import { Request, Response, NextFunction } from "express";
import { authService } from "./auth.service";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import {
  recordLoginFail,
  resetLoginFails,
} from "../../middleware/rate-limit.middleware";
import logger from "../../config/logger";

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
};
