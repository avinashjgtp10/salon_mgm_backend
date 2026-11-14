import type { PoolClient } from "pg";
import pool from "../../config/database";
import logger from "../../config/logger";
import { notificationsService } from "../notifications/notifications.service";
import { getSalonDateLocale } from "../../config/currency";
import { salonWallClockNow } from "../../config/salonTimezone";
import { upcomingFestivals } from "./festival.calendar";

// Once a salon's local morning has come, tell the owner about every festival now within REMIND_DAYS_BEFORE days, one bell
// notification per festival per year.
//
// No duplicates: the notification is written with deduplicate (notifications.createOnce: one row per salon + type + reference),
// and the reference is "<festival>:<date>", so re-running the sweep, a restart, or a second server instance cannot add another.
// "Within" rather than "exactly 14 days": if the server was down on the day, the reminder still arrives, once, a little late.
const REMIND_DAYS_BEFORE = 14;
const LOCAL_HOUR_FROM = 9;
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const LOCK_ID = 73190477;

let timer: NodeJS.Timeout | null = null;
let running = false;

export async function runFestivalReminderSweep(): Promise<number> {
    if (running) return 0;
    running = true;
    let client: PoolClient | undefined;
    let locked = false;
    let sent = 0;
    try {
        client = await pool.connect();
        const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [LOCK_ID]);
        locked = lock.rows[0]?.locked === true;
        if (!locked) return 0;

        const { rows: salons } = await client.query<{ id: string; country: string | null; state: string | null; timezone: string | null }>(
            `SELECT id, country, state, timezone FROM salons WHERE COALESCE(is_active, true) = true`
        );
        for (const salon of salons) {
            try {
                const tz = salon.timezone || "Asia/Kolkata";
                const now = salonWallClockNow(tz);
                if (now.getUTCHours() < LOCAL_HOUR_FROM) continue; // the salon's own morning, not the server's
                const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
                const festivals = upcomingFestivals({ country: salon.country, state: salon.state, today, daysAhead: REMIND_DAYS_BEFORE });
                if (festivals.length === 0) continue;

                const locale = await getSalonDateLocale(salon.id);
                for (const f of festivals) {
                    const when = new Date(`${f.date}T00:00:00Z`).toLocaleDateString(locale || "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
                    const launch = new Date(`${f.launchBy}T00:00:00Z`).toLocaleDateString(locale || "en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
                    const created = await notificationsService.create(
                        {
                            salon_id: salon.id,
                            type: "festival",
                            reference_id: `${f.key}:${f.date}`,
                            title: `${f.name} is coming on ${when}`,
                            body: `Prepare a special festive offer for your clients. Launch your campaign by ${launch}. Open Marketing to get ideas and create a WhatsApp campaign.`,
                        },
                        { deduplicate: true }
                    );
                    if (created) sent++;
                }
            } catch (err) {
                logger.error("[festivals] reminder failed for a salon", { salonId: salon.id, error: (err as Error)?.message });
            }
        }
    } finally {
        if (client) {
            if (locked) await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
            client.release();
        }
        running = false;
    }
    if (sent > 0) logger.info("[festivals] reminders created", { sent });
    return sent;
}

export function startFestivalReminderScheduler() {
    if (timer) return;
    const sweep = () => void runFestivalReminderSweep().catch((error) => logger.error("Festival reminder sweep failed", { error }));
    // First run a minute after boot so startup stays quick, then hourly: each salon's 9:00 arrives at a different hour of the day.
    setTimeout(sweep, 60_000);
    timer = setInterval(sweep, SWEEP_EVERY_MS);
}

export function stopFestivalReminderScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
}
