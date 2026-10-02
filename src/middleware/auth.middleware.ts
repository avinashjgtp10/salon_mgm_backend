import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "./error.middleware";
import { isSessionActive } from "../modules/auth/session.util";

export const authMiddleware = async (
  req: Request & { user?: any },
  _res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new AppError(401, "Authorization header missing", "NO_AUTH_HEADER");
    }

    const [type, token] = authHeader.split(" ");

    if (type !== "Bearer" || !token) {
      throw new AppError(401, "Invalid token format", "INVALID_TOKEN_FORMAT");
    }

    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) {
      throw new AppError(500, "JWT access secret missing", "JWT_SECRET_MISSING");
    }

    const decoded: any = jwt.verify(token, secret);

    // Single-login-per-account: a token minted for a login session carries
    // that session's id. If the session was ended (the account logged in
    // elsewhere, logout, password reset) the token stops working at once
    // instead of lingering until it expires. Tokens with no `sid` (issued
    // before this existed, the super-admin's own login, and the branch-owner
    // "enter salon" token) are not checked.
    if (decoded?.sid) {
      let active = true;
      try {
        active = await isSessionActive(String(decoded.sid));
      } catch {
        // A DB hiccup must never sign everyone out — fail open.
        active = true;
      }
      if (!active) {
        return next(new AppError(
          401,
          "You were signed out because this account was logged in on another device.",
          "SESSION_REPLACED",
        ));
      }
    }

    req.user = decoded;
    return next();
  } catch (err) {
    return next(new AppError(401, "Unauthorized", "INVALID_TOKEN"));
  }
};
