// Subscription expiry reminders: one email a day for the last five days and on the expiry day, each at most once per period,
// retried if the send fails, never for a subscription that is not live / will renew by itself / has been renewed.
const sendReminder = jest.fn();
jest.mock("../utils/email.service", () => ({ emailService: { sendSubscriptionExpiryReminderEmail: (...a: unknown[]) => sendReminder(...a) } }));
const sendWa = jest.fn();
jest.mock("./subscription-expiry-whatsapp", () => ({ sendExpiryWhatsApp: (...a: unknown[]) => sendWa(...a) }));
jest.mock("../../config/env", () => ({ __esModule: true, default: { frontend: { url: "https://app.example" } } }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const claimed = new Set<string>();
let selectRows: any[] = [];
const queries: string[] = [];
const query = jest.fn(async (sql: string, params: any[] = []) => {
    queries.push(sql);
    if (/CREATE TABLE/i.test(sql)) return { rowCount: 0, rows: [] };
    if (/^\s*SELECT s\.id AS subscription_id/i.test(sql)) return { rows: selectRows };
    const m = /^\s*(INSERT INTO|DELETE FROM) (subscription_expiry_(?:whatsapp_)?reminders)/i.exec(sql);
    if (m) {
        const key = m[2] + "|" + params.map(String).join("|");
        if (/INSERT/i.test(m[1])) {
            if (claimed.has(key)) return { rowCount: 0, rows: [] };
            claimed.add(key);
            return { rowCount: 1, rows: [{ subscription_id: params[0] }] };
        }
        claimed.delete(key);
        return { rowCount: 1, rows: [] };
    }
    throw new Error("unexpected query: " + sql.slice(0, 60));
});
jest.mock("../../config/database", () => ({ __esModule: true, default: { query: (...a: [string, any[]?]) => query(...a) } }));

import { milestoneFor, REMINDER_DAYS, runExpiryReminderSweep } from "./subscription-expiry-reminder.service";

const row = (days: number, over: object = {}) => ({
    subscription_id: "sub-1", current_period_end: "2026-11-10T10:00:00Z", plan_name: "SalonOx Basic", salon_name: "Glow",
    owner_email: "owner@glow.com", owner_first_name: "Asha", days_remaining: days, ...over,
});

beforeEach(() => { sendWa.mockReset(); sendWa.mockResolvedValue({ sent: true }); sendReminder.mockReset(); claimed.clear(); queries.length = 0; selectRows = []; });

describe("schedule", () => {
    it("is 5, 4, 3, 2, 1 days before and the expiry day", () => {
        expect(REMINDER_DAYS).toEqual([5, 4, 3, 2, 1, 0]);
        for (const d of [5, 4, 3, 2, 1, 0]) expect(milestoneFor(d)).toBe(d);
    });
    it("sends nothing earlier than 5 days out or after the expiry", () => {
        for (const d of [6, 7, 30, -1]) expect(milestoneFor(d)).toBeNull();
    });
});

describe("runExpiryReminderSweep", () => {
    it("sends the reminder with the real expiry date and the billing link", async () => {
        selectRows = [row(3)];
        const out = await runExpiryReminderSweep();
        expect(out).toEqual({ checked: 1, sent: 1, whatsappSent: 0 });
        const m = sendReminder.mock.calls[0][0];
        expect(m).toMatchObject({ to: "owner@glow.com", ownerName: "Asha", salonName: "Glow", planName: "SalonOx Basic", daysRemaining: 3 });
        expect(m.expiryDate).toContain("2026");
        expect(m.subscriptionUrl).toBe("https://app.example/dashboard/settings/billing");
    });

    it("sends on the expiry day too (0 days remaining)", async () => {
        selectRows = [row(0)];
        expect((await runExpiryReminderSweep()).sent).toBe(1);
        expect(sendReminder.mock.calls[0][0].daysRemaining).toBe(0);
    });

    it("never sends the same reminder twice, however many sweeps run", async () => {
        selectRows = [row(2)];
        await runExpiryReminderSweep();
        await runExpiryReminderSweep();
        await Promise.all([runExpiryReminderSweep(), runExpiryReminderSweep()]);
        expect(sendReminder).toHaveBeenCalledTimes(1);
    });

    it("sends the next day's reminder, and a fresh one after a renewal moves the end date", async () => {
        selectRows = [row(3)];
        await runExpiryReminderSweep();
        selectRows = [row(2)];
        await runExpiryReminderSweep();
        selectRows = [row(3, { current_period_end: "2027-11-10T10:00:00Z" })];   // renewed for a year, then it nears the end again
        await runExpiryReminderSweep();
        expect(sendReminder).toHaveBeenCalledTimes(3);
    });

    it("retries after a failed send, without duplicating once it succeeds", async () => {
        selectRows = [row(1)];
        sendReminder.mockRejectedValueOnce(new Error("smtp down"));
        expect((await runExpiryReminderSweep()).sent).toBe(0);
        expect((await runExpiryReminderSweep()).sent).toBe(1);
        expect((await runExpiryReminderSweep()).sent).toBe(0);
        expect(sendReminder).toHaveBeenCalledTimes(2);
    });

    it("skips an owner with no email and a day that has no reminder", async () => {
        selectRows = [row(3, { owner_email: null }), row(6)];
        expect((await runExpiryReminderSweep()).sent).toBe(0);
        expect(sendReminder).not.toHaveBeenCalled();
    });

    describe("WhatsApp (Super Meta)", () => {
        const withPhone = (days: number, over: object = {}) => row(days, { owner_phone: "9876543210", ...over });

        it("sends one WhatsApp per milestone with the real details, alongside the email", async () => {
            selectRows = [withPhone(3)];
            const out = await runExpiryReminderSweep();
            expect(out).toEqual({ checked: 1, sent: 1, whatsappSent: 1 });
            expect(sendWa.mock.calls[0][0]).toMatchObject({ ownerPhone: "9876543210", ownerName: "Asha", salonName: "Glow", planName: "SalonOx Basic", daysRemaining: 3 });
            await runExpiryReminderSweep();
            await Promise.all([runExpiryReminderSweep(), runExpiryReminderSweep()]);
            expect(sendWa).toHaveBeenCalledTimes(1);
            expect(sendReminder).toHaveBeenCalledTimes(1);
        });

        it("sends nothing on WhatsApp without a phone, and the email still goes", async () => {
            selectRows = [row(3)];
            expect((await runExpiryReminderSweep()).whatsappSent).toBe(0);
            expect(sendWa).not.toHaveBeenCalled();
            expect(sendReminder).toHaveBeenCalledTimes(1);
        });

        it("still sends WhatsApp when the owner has no email", async () => {
            selectRows = [withPhone(2, { owner_email: null })];
            expect(await runExpiryReminderSweep()).toMatchObject({ sent: 0, whatsappSent: 1 });
        });

        it("retries later when the platform number / template is not ready, without touching the email", async () => {
            selectRows = [withPhone(1)];
            sendWa.mockResolvedValueOnce({ sent: false, skipped: "template_pending" });
            expect((await runExpiryReminderSweep()).whatsappSent).toBe(0);
            expect((await runExpiryReminderSweep()).whatsappSent).toBe(1);
            expect(sendWa).toHaveBeenCalledTimes(2);
            expect(sendReminder).toHaveBeenCalledTimes(1);   // email went once, not again
        });

        it("a WhatsApp failure is retried and never blocks or repeats the email", async () => {
            selectRows = [withPhone(0)];
            sendWa.mockRejectedValueOnce(new Error("meta down"));
            await runExpiryReminderSweep();
            await runExpiryReminderSweep();
            expect(sendWa).toHaveBeenCalledTimes(2);
            expect(sendReminder).toHaveBeenCalledTimes(1);
        });

        it("an email failure does not stop or repeat the WhatsApp", async () => {
            selectRows = [withPhone(4)];
            sendReminder.mockRejectedValueOnce(new Error("smtp down"));
            await runExpiryReminderSweep();
            await runExpiryReminderSweep();
            expect(sendWa).toHaveBeenCalledTimes(1);
            expect(sendReminder).toHaveBeenCalledTimes(2);
        });
    });

    it("only selects live, paid, non-renewing subscriptions and drops renewed ones", async () => {
        await runExpiryReminderSweep();
        const sql = queries.find((q) => /SELECT s\.id AS subscription_id/.test(q))!;
        expect(sql).toMatch(/s\.status = 'active'/);                          // not cancelled / inactive / expired
        expect(sql).toMatch(/is_trial, FALSE\) = FALSE/);                     // paid plans only
        expect(sql).toMatch(/cancel_at_period_end, FALSE\) = TRUE OR s\.razorpay_subscription_id IS NULL/);   // will not renew by itself
        expect(sql).toMatch(/s\.current_period_end/);                         // the subscription's own expiry date
        expect(sql).not.toMatch(/subscription_invoices/);                     // never the invoice date
        expect(sql).toMatch(/p\.billing_period_end > s\.current_period_end/); // paid again for a later period
        expect(sql).toMatch(/s2\.current_period_end > s\.current_period_end/); // a replacement subscription ends later
    });
});
