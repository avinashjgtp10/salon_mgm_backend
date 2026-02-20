import { z } from "zod";
import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";

/**
 * REGISTER VALIDATION
 */
export const validateRegister = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const { email, password, first_name, role } = req.body;

  if (!email) {
    return next(new AppError(400, "Email is required", "VALIDATION_ERROR"));
  }

  if (!password || password.length < 6) {
    return next(
      new AppError(
        400,
        "Password must be at least 6 characters",
        "VALIDATION_ERROR",
      ),
    );
  }

  if (!first_name) {
    return next(
      new AppError(400, "First name is required", "VALIDATION_ERROR"),
    );
  }

  const allowedRoles = ["salon_owner", "staff", "client", "admin"];

  if (!role || !allowedRoles.includes(role)) {
    return next(
      new AppError(
        400,
        "Role must be salon_owner, staff, client or admin",
        "VALIDATION_ERROR",
      ),
    );
  }

  next();
};

/**
 * LOGIN VALIDATION
 */
export const validateLogin = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(
      new AppError(400, "Email and password required", "VALIDATION_ERROR"),
    );
  }

  next();
};

/**
 * REFRESH TOKEN VALIDATION
 */
export const validateRefresh = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return next(new AppError(400, "refreshToken required", "VALIDATION_ERROR"));
  }

  next();
};

export const googleCallbackQuerySchema = z.object({
  code: z.string().min(1, "code required"),
  state: z.string().min(1, "state required"),
});

export const googleStartQuerySchema = z.object({
  returnTo: z.string().optional(),
});

