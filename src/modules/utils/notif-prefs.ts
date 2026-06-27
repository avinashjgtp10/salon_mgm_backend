import pool from "../../config/database";

const PREF_KEY = "notification_preferences";

/**
 * Returns true if the given event's email channel is enabled for the salon.
 * Defaults to true when no preference has been saved yet.
 */
export async function canSendEmail(salonId: string, eventKey: string): Promise<boolean> {
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
    if (prefs?.channels?.email === false) return false;
    if (prefs?.events?.[eventKey]?.email === false) return false;
    return true;
  } catch {
    return true;
  }
}
