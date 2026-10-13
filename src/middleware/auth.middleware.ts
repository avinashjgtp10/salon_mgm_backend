import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "./error.middleware";
import { isSessionActive, getSessionPlatform } from "../modules/auth/session.util";
import { clientActivityTracker } from "../modules/client-activity/client-activity.tracker";

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

    // Client Activity Tracking (Super Admin): tie this request to the account and the platform (Web / App)
    // its login session came from. Fire-and-forget; super-admins and impersonation tokens (no sid) skip it.
    if (decoded?.sid && decoded.role !== "super_admin") {
      const platform = getSessionPlatform(String(decoded.sid));
      if (platform) {
        clientActivityTracker.touch({
          userId: String(decoded.userId), salonId: decoded.salonId ?? null, platform,
          url: req.originalUrl, ip: req.ip, userAgent: String(req.headers["user-agent"] || ""),
        });
      }
    }

    req.user = decoded;
    return next();
  } catch (err) {
    return next(new AppError(401, "Unauthorized", "INVALID_TOKEN"));
  }
};
