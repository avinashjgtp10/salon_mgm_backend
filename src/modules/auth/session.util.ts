// Single-login-per-account sessions, one per client type (web / mobile).
//
// A "session" is simply a row in refresh_tokens. Every access token minted
// for it carries that row's id as `sid`; authMiddleware then rejects the
// token the moment the row is gone. A normal login deletes the user's other
// rows first, so signing in on a second device instantly signs the first one
// out (its next request fails with SESSION_REPLACED).
//
// Deliberately NOT done here: super-admin impersonation and the branch-owner
// "enter salon" token. Impersonation adds its own session row without
// deleting anyone's (so it never logs the real user out), and a real login
// deleting all rows ends any impersonation session too.
import jwt, { SignOptions } from "jsonwebtoken";
import { authRepository } from "./auth.repository";
import { deviceTokensRepository } from "../notifications/deviceTokens.repository";
import type { ClientType } from "./auth.types";

// Roles that may hold several sessions at once: super-admins work across
// many tabs, and public-booking `client` accounts have no salon seat to
// protect.
const MULTI_SESSION_ROLES = new Set(["super_admin", "client"]);

const accessOptions = (): SignOptions => ({
  expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN || "15m") as any,
});
const refreshOptions = (): SignOptions => ({
  expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || "30d") as any,
});

export function refreshExpiryDate(): Date {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

/**
 * Starts a new login session and returns its tokens. With `kickOthers` (the
 * normal case for a real login) every other session of this user is ended
 * first — except for roles allowed multiple sessions.
 */
export async function issueSessionTokens(opts: {
  userId: string;
  role: string;
  salonId?: string | null;
  kickOthers: boolean;
  clientType?: ClientType;
}): Promise<{ accessToken: string; refreshToken: string }> {
  const { userId, role, salonId, kickOthers } = opts;
  const clientType: ClientType = opts.clientType === "mobile" ? "mobile" : "web";
  if (kickOthers && !MULTI_SESSION_ROLES.has(role)) {
    // One session per client type: only the same type is ended, so a web
    // login and a phone login can coexist.
    await authRepository.deleteRefreshTokensForUserByClientType(userId, clientType);
    // A signed-out phone can't unregister itself, so drop its push token here;
    // otherwise it keeps showing this account's pushes after being kicked.
    // The device logging in now re-registers its token right after login.
    // Only a mobile login kicks a phone, so a web login must leave them alone.
    if (clientType === "mobile") await deviceTokensRepository.removeAllForUser(userId);
  }
  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET as string, refreshOptions());
  const row = await authRepository.saveRefreshToken({
    user_id: userId,
    token: refreshToken,
    expires_at: refreshExpiryDate(),
    client_type: clientType,
  });
  const accessToken = jwt.sign(
    { userId, role, salonId: salonId ?? null, sid: String(row.id) },
    process.env.JWT_ACCESS_SECRET as string,
    accessOptions(),
  );
  return { accessToken, refreshToken };
}

// ── Per-request session check ────────────────────────────────────────────────
// A positive result is cached for a few seconds so the check costs one
// indexed lookup per session per few seconds, not one per API call. A kicked
// session is therefore cut off within the TTL (usually the very next click).
const ACTIVE_TTL_MS = 5_000;
const MAX_CACHE = 5_000;
const activeUntil = new Map<string, number>();

export async function isSessionActive(sid: string): Promise<boolean> {
  const now = Date.now();
  const hit = activeUntil.get(sid);
  if (hit && hit > now) return true;

  const ok = await authRepository.isRefreshSessionActive(sid);  if (ok) {
    if (activeUntil.size >= MAX_CACHE) {
      for (const [k, until] of activeUntil) if (until <= now) activeUntil.delete(k);
      if (activeUntil.size >= MAX_CACHE) activeUntil.clear();
    }
    activeUntil.set(sid, now + ACTIVE_TTL_MS);
  } else {
    activeUntil.delete(sid);
  }
  return ok;
}
