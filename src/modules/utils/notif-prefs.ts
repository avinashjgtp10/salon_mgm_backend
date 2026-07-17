import pool from "../../config/database";

const PREF_KEY = "notification_preferences";

/**
 * Returns true if the given event's channel (email/push) is enabled for the
 * salon. Defaults to true when no preference has been saved yet. Shared by
 * canSendEmail/canSendPush below — same salon_settings blob, same shape
 * (`{ channels: {email,push}, events: { [eventKey]: {email,push} } }`,
 * see NotificationsPage.tsx), just a different field name per channel.
 */
async function canSendChannel(salonId: string, eventKey: string, channel: "email" | "push"): Promise<boolean> {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM salon_settings WHERE salon_id = $1 AND key = $2 LIMIT 1`,
      [salonId, PREF_KEY],
    );
    if (!rows[0]) return true;
    const raw =
      typeof rows[0].value === "string"
        ? rows[0].value
        : JSON.stringify(rows[0].value);
    const prefs = JSON.parse(raw);
    if (prefs?.channels?.[channel] === false) return false;
    if (prefs?.events?.[eventKey]?.[channel] === false) return false;
    return true;
  } catch {
    return true;
  }
}

export const canSendEmail = (salonId: string, eventKey: string): Promise<boolean> =>
  canSendChannel(salonId, eventKey, "email");

export const canSendPush = (salonId: string, eventKey: string): Promise<boolean> =>
  canSendChannel(salonId, eventKey, "push");
