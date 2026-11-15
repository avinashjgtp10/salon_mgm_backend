// ============================================================
// SalonOx — Subscription Expiry Reminder
// ============================================================
// Emails the salon owner every day as a paid subscription approaches its end date: 5, 4, 3, 2 and 1 days before, and on the expiry
// day itself, each at most once per subscription period. A daily sweep (8am IST, plus one shortly after boot to catch the
// current day if the server was down at 8am) picks the subscriptions that need one.
//
// The date that counts is the subscription's own current_period_end (never an invoice date), compared as calendar days in IST.
//
// Who is reminded: an ACTIVE, paid (non-trial) subscription of an active salon whose period ends within the next 5 days and which
// will NOT renew by itself:
//   - one set to stop at the end of the period (cancel_at_period_end), or
//   - one with no Razorpay subscription behind it (a plan a Super Admin granted, a manual / offline payment).
// A live Razorpay subscription renews automatically, so telling its owner it is "about to expire" would only confuse them.
//
// Reminders stop by themselves as soon as the subscription is renewed or paid again: its current_period_end moves (and the
// history below is keyed on it), a replacement subscription for the salon takes over, or a later paid period exists. Cancelled
// and inactive subscriptions are never selected (status must be 'active').

import pool from "../../config/database";
import logger from "../../config/logger";
import config from "../../config/env";
import { emailService } from "../utils/email.service";

/** Days before the end date at which a reminder goes out (0 = the expiry day itself): one a day for the last five days. */
export const REMINDER_DAYS = [5, 4, 3, 2, 1, 0];

let timer: NodeJS.Timeout | null = null;
let bootTimer: NodeJS.Timeout | null = null;
let tableReady: Promise<boolean> | null = null;

// Same approach as the other optional tables: created on first use; if the database user may not create tables the sweep
// does nothing (it must not send without being able to remember that it did).
function ensureTable(): Promise<boolean> {
    if (!tableReady) {
        tableReady = pool
            .query(
                `CREATE TABLE IF NOT EXISTS subscription_expiry_reminders (
                    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
                    period_end      TIMESTAMPTZ NOT NULL,
                    days_before     INT         NOT NULL,
                    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (subscription_id, period_end, days_before)
                )`
            )
            .then(() => true)
            .catch((err: any) => {
                logger.error("[SUBSCRIPTION-EXPIRY-REMINDER] Could not prepare the reminders table", { error: err?.message });
                tableReady = null;   // try again on the next sweep
                return false;
            });
    }
    return tableReady;
}

/** The reminder that is due for a subscription with `daysRemaining` days left (exactly that day), or null when none is. */
export function milestoneFor(daysRemaining: number, days: number[] = REMINDER_DAYS): number | null {
    return days.includes(daysRemaining) ? daysRemaining : null;
}

const fmtDate = (v: unknown) =>
    new Date(v as string).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export async function runExpiryReminderSweep(): Promise<{ checked: number; sent: number }> {
    if (!(await ensureTable())) return { checked: 0, sent: 0 };

    const maxDays = Math.max(...REMINDER_DAYS);
    const { rows } = await pool.query(
        `SELECT s.id AS subscription_id, s.current_period_end,
                sp.name AS plan_name,
                COALESCE(sa.business_name, sa.slug, 'your salon') AS salon_name,
                u.email AS owner_email, u.first_name AS owner_first_name,
                ((s.current_period_end AT TIME ZONE 'Asia/Kolkata')::date - (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS days_remaining
         FROM subscriptions s
         JOIN salons sa ON sa.id = s.salon_id
         LEFT JOIN users u ON u.id = sa.owner_id
         LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
         WHERE s.status = 'active'
           AND COALESCE(s.is_trial, FALSE) = FALSE
           AND s.current_period_end IS NOT NULL
           AND ((s.current_period_end AT TIME ZONE 'Asia/Kolkata')::date - (NOW() AT TIME ZONE 'Asia/Kolkata')::date) BETWEEN 0 AND $1
           AND (COALESCE(s.cancel_at_period_end, FALSE) = TRUE OR s.razorpay_subscription_id IS NULL)
           AND COALESCE(sa.is_active, TRUE) = TRUE
           -- renewed / paid again: a later paid period for this subscription, or another live subscription that ends later
           AND NOT EXISTS (SELECT 1 FROM subscription_payments p
                           WHERE p.subscription_id = s.id AND p.payment_status = 'paid' AND p.billing_period_end > s.current_period_end)
           AND NOT EXISTS (SELECT 1 FROM subscriptions s2
                           WHERE s2.salon_id = s.salon_id AND s2.id <> s.id AND s2.status = 'active'
                             AND s2.current_period_end > s.current_period_end)`,
        [maxDays]
    );

    let sent = 0;
    for (const r of rows) {
        const days = Number(r.days_remaining);
        const milestone = milestoneFor(days);
        if (milestone === null || !r.owner_email) continue;

        // The claim: only the run whose INSERT succeeds sends this reminder.
        const claim = await pool.query(
            `INSERT INTO subscription_expiry_reminders (subscription_id, period_end, days_before)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING subscription_id`,
            [r.subscription_id, r.current_period_end, milestone]
        );
        if (!claim.rowCount) continue;

        try {
            await emailService.sendSubscriptionExpiryReminderEmail({
                to: r.owner_email,
                ownerName: r.owner_first_name,
                salonName: r.salon_name,
                planName: r.plan_name ?? "SalonOx",
                expiryDate: fmtDate(r.current_period_end),
                daysRemaining: Math.max(days, 0),
                subscriptionUrl: `${config.frontend.url}/dashboard/settings/billing`,
            });
            sent++;
        } catch (err: any) {
            // Hand the claim back so the next sweep retries this reminder.
            await pool
                .query(`DELETE FROM subscription_expiry_reminders WHERE subscription_id = $1 AND period_end = $2 AND days_before = $3`,
                    [r.subscription_id, r.current_period_end, milestone])
                .catch(() => undefined);
            logger.error("[SUBSCRIPTION-EXPIRY-REMINDER] Send failed", { subscriptionId: r.subscription_id, error: err?.message });
        }
    }
    logger.info(`[SUBSCRIPTION-EXPIRY-REMINDER] Sweep complete — ${rows.length} expiring, ${sent} reminder(s) sent`);
    return { checked: rows.length, sent };
}

function msUntilNextIST8AM(): number {
    const nowIst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const target = new Date(nowIst);
    target.setHours(8, 0, 0, 0);
    if (target <= nowIst) target.setDate(target.getDate() + 1);
    return target.getTime() - nowIst.getTime();
}

const sweepSafely = () =>
    runExpiryReminderSweep().catch((err) => logger.error("[SUBSCRIPTION-EXPIRY-REMINDER] Job error:", { error: err?.message }));

export function startSubscriptionExpiryReminderScheduler(): void {
    if (timer) return;
    const delay = msUntilNextIST8AM();
    logger.info(`[SUBSCRIPTION-EXPIRY-REMINDER] ⏰ Scheduled — next run in ${Math.round(delay / 60000)} min, then every 24h at 8am IST`);

    // Once shortly after boot, so a day the server was down is not skipped (the claim keeps repeats from sending twice).
    bootTimer = setTimeout(sweepSafely, 60_000);

    timer = setTimeout(function run() {
        void sweepSafely();
        timer = setInterval(sweepSafely, 24 * 60 * 60 * 1000);
    }, delay);
}

export function stopSubscriptionExpiryReminderScheduler(): void {
    if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
    if (timer) {
        clearTimeout(timer);
        clearInterval(timer);
        timer = null;
        logger.info("[SUBSCRIPTION-EXPIRY-REMINDER] ⏰ Stopped");
    }
}
