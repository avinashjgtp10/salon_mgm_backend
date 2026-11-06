import { NextFunction, Request, Response } from "express";
import { getSessionPlatform } from "../modules/auth/session.util";
import { AppError } from "./error.middleware";

type SessionRequest = Request & { user?: { sid?: string } };

/**
 * Only requests from a mobile-app login session pass. Runs after authMiddleware, which has already looked the
 * session up (isSessionActive) and cached its platform from refresh_tokens.client_type ("mobile" → "app").
 * Tokens without a session id (impersonation, older tokens) are treated as not-mobile.
 */
export function requireMobileApp(req: SessionRequest, _res: Response, next: NextFunction) {
    const sid = req.user?.sid;
    if (!sid || getSessionPlatform(String(sid)) !== "app") {
        return next(new AppError(403, "This feature is only available in the SalonOX mobile app.", "MOBILE_ONLY"));
    }
    return next();
}
