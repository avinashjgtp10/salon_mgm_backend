import pool from "../../config/database";
import logger from "../../config/logger";

// Records client activity for Super Admin's Client Activity Tracking. Everything here is fire-and-forget
// and swallows its own errors: tracking must never slow down or break a real request, and until
// Migration/create_client_activity_tracking.sql has been run it simply logs once and does nothing.

export type ActivityPlatform = "web" | "app";

// Last-activity writes are coalesced: at most one summary UPDATE per account + platform per minute, and
// one 'activity' history row per account + platform + module per 10 minutes. Without this every API call
// would be a DB write.
const SUMMARY_TOUCH_MS = 60_000;
const EVENT_MODULE_MS = 10 * 60_000;
const MAX_KEYS = 20_000;

const lastSummaryWrite = new Map<string, number>();
const lastModuleEvent = new Map<string, number>();

function remember(map: Map<string, number>, key: string, now: number) {
  if (map.size >= MAX_KEYS) map.clear();
  map.set(key, now);
}

// Requests a browser/phone makes on its own while nobody is doing anything (badge polls, presence, token
// refresh...) - counting them would make an idle open tab look "active" forever.
const BACKGROUND_PATH = /(unread-count|\/support\/my|presence|\/notifications|\/auth\/|\/device|\/app\/version|\/health|\/bot\b|\/socket)/i;

/** "/api/v1/appointments/123?x=1" -> "appointments"; null when it is not a real API module. */
export function moduleFromUrl(url: string): string | null {
  const path = String(url || "").split("?")[0];
  if (BACKGROUND_PATH.test(path)) return null;
  const m = /^\/api\/v\d+\/([a-z0-9_-]+)/i.exec(path);
  return m ? m[1].toLowerCase().slice(0, 60) : null;
}

let warnedMissingTable = false;
function onError(where: string, err: any) {
  if (err?.code === "42P01" || err?.code === "42703") {
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      logger.warn("[client-activity] tracking tables missing - run Migration/create_client_activity_tracking.sql", { where });
    }
    return;
  }
  logger.warn("[client-activity] write failed", { where, error: err?.message });
}

const clip = (v: unknown, n: number): string | null => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, n) : null;
};

export const clientActivityTracker = {
  /** A real login (not an impersonation / super-admin session). */
  async recordLogin(p: { userId: string; salonId?: string | null; platform: ActivityPlatform; ip?: string | null; userAgent?: string | null }) {
    try {
      const ip = clip(p.ip, 64);
      const ua = clip(p.userAgent, 500);
      await pool.query(
        `INSERT INTO client_activity_summary
           (user_id, platform, salon_id, first_login_at, last_login_at, last_activity_at, login_count, last_ip, last_user_agent)
         VALUES ($1, $2, $3, NOW(), NOW(), NOW(), 1, $4, $5)
         ON CONFLICT (user_id, platform) DO UPDATE SET
           salon_id         = COALESCE(EXCLUDED.salon_id, client_activity_summary.salon_id),
           first_login_at   = COALESCE(client_activity_summary.first_login_at, EXCLUDED.first_login_at),
           last_login_at    = NOW(),
           last_activity_at = NOW(),
           login_count      = client_activity_summary.login_count + 1,
           last_ip          = EXCLUDED.last_ip,
           last_user_agent  = EXCLUDED.last_user_agent,
           updated_at       = NOW()`,
        [p.userId, p.platform, p.salonId ?? null, ip, ua],
      );
      await pool.query(
        `INSERT INTO client_activity_events (user_id, salon_id, platform, event_type, ip, user_agent)
         VALUES ($1, $2, $3, 'login', $4, $5)`,
        [p.userId, p.salonId ?? null, p.platform, ip, ua],
      );
      remember(lastSummaryWrite, `${p.userId}|${p.platform}`, Date.now());
    } catch (err) {
      onError("recordLogin", err);
    }
  },

  async recordLogout(p: { userId: string; platform: ActivityPlatform; salonId?: string | null }) {
    try {
      await pool.query(
        `UPDATE client_activity_summary SET last_logout_at = NOW(), updated_at = NOW() WHERE user_id = $1 AND platform = $2`,
        [p.userId, p.platform],
      );
      await pool.query(
        `INSERT INTO client_activity_events (user_id, salon_id, platform, event_type) VALUES ($1, $2, $3, 'logout')`,
        [p.userId, p.salonId ?? null, p.platform],
      );
    } catch (err) {
      onError("recordLogout", err);
    }
  },

  /** Called from authMiddleware for every authenticated request of a tracked session. */
  touch(p: { userId: string; salonId?: string | null; platform: ActivityPlatform; url: string; ip?: string | null; userAgent?: string | null }): void {
    const module = moduleFromUrl(p.url);
    if (!module) return;                               // background poll / non-API path
    const now = Date.now();
    const accountKey = `${p.userId}|${p.platform}`;

    const writeSummary = !lastSummaryWrite.has(accountKey) || now - (lastSummaryWrite.get(accountKey) ?? 0) >= SUMMARY_TOUCH_MS;
    const moduleKey = `${accountKey}|${module}`;
    const writeEvent = !lastModuleEvent.has(moduleKey) || now - (lastModuleEvent.get(moduleKey) ?? 0) >= EVENT_MODULE_MS;
    if (!writeSummary && !writeEvent) return;

    if (writeSummary) remember(lastSummaryWrite, accountKey, now);
    if (writeEvent) remember(lastModuleEvent, moduleKey, now);

    const ip = clip(p.ip, 64);
    const ua = clip(p.userAgent, 500);
    void (async () => {
      try {
        if (writeSummary) {
          // Upsert, so an account that was already logged in when tracking was switched on still shows up.
          await pool.query(
            `INSERT INTO client_activity_summary (user_id, platform, salon_id, last_activity_at, login_count, last_module, last_ip, last_user_agent)
             VALUES ($1, $2, $3, NOW(), 0, $4, $5, $6)
             ON CONFLICT (user_id, platform) DO UPDATE SET
               salon_id         = COALESCE(EXCLUDED.salon_id, client_activity_summary.salon_id),
               last_activity_at = NOW(),
               last_module      = EXCLUDED.last_module,
               last_ip          = COALESCE(EXCLUDED.last_ip, client_activity_summary.last_ip),
               last_user_agent  = COALESCE(EXCLUDED.last_user_agent, client_activity_summary.last_user_agent),
               updated_at       = NOW()`,
            [p.userId, p.platform, p.salonId ?? null, module, ip, ua],
          );
        }
        if (writeEvent) {
          await pool.query(
            `INSERT INTO client_activity_events (user_id, salon_id, platform, event_type, module, ip, user_agent)
             VALUES ($1, $2, $3, 'activity', $4, $5, $6)`,
            [p.userId, p.salonId ?? null, p.platform, module, ip, ua],
          );
        }
      } catch (err) {
        onError("touch", err);
      }
    })();
  },
};
