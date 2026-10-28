import Razorpay from "razorpay";
import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { getRazorpayCredentials, invalidateRazorpayCredentials, type RazorpaySource } from "../../config/razorpay";
import { encryptSecret, secretBoxConfigured } from "../ai-credentials/secret-box";

// Super Admin's global Razorpay settings (one set for the whole platform). Secrets are stored encrypted and never returned:
// the status only says whether each one is set, where it comes from, and (for DB-stored ones) its last 4 characters.

const WEBHOOK_PATH = "/api/v1/subscriptions/webhook";
const WEBHOOK_EVENTS = [
    "subscription.authenticated", "subscription.activated", "subscription.charged", "subscription.cancelled",
    "subscription.completed", "subscription.halted", "subscription.paused", "payment.captured", "payment.failed", "order.paid",
];

const modeOf = (keyId: string | null): "test" | "live" | null =>
    keyId?.startsWith("rzp_test_") ? "test" : keyId?.startsWith("rzp_live_") ? "live" : null;

type Row = { key_id: string | null; key_secret_last4: string | null; webhook_secret_last4: string | null; updated_at: string | null; updated_by_name: string | null };

async function loadRow(): Promise<Row | null> {
    try {
        const { rows } = await pool.query(
            `SELECT p.key_id, p.key_secret_last4, p.webhook_secret_last4, p.updated_at, TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) AS updated_by_name
             FROM platform_razorpay_settings p LEFT JOIN users u ON u.id = p.updated_by WHERE p.id = TRUE`
        );
        return rows[0] ?? null;
    } catch (err: any) {
        if (err?.code === "42P01") return null;
        throw err;
    }
}

// One harmless read-only call, so wrong keys are caught when they are saved instead of at a customer's checkout.
async function verifyKeys(keyId: string, keySecret: string): Promise<void> {
    try {
        await new Razorpay({ key_id: keyId, key_secret: keySecret }).orders.all({ count: 1 });
    } catch (err: any) {
        const status = err?.statusCode ?? err?.error?.statusCode;
        logger.warn("[payment-gateway] key verification failed", { status });
        if (status === 401 || status === 403) throw new AppError(400, "Razorpay rejected these keys. Check the Key ID and Key Secret belong together.", "VALIDATION_ERROR");
        throw new AppError(502, `Could not reach Razorpay to check the keys: ${err?.error?.description ?? err?.message ?? "unknown error"}`, "UPSTREAM_ERROR");
    }
}

const last4 = (s: string) => s.slice(-4);

export const paymentGatewayService = {
    async getStatus() {
        const [row, creds] = await Promise.all([loadRow(), getRazorpayCredentials()]);
        const src = (s: RazorpaySource) => s;
        return {
            key_id: creds.keyId,
            mode: modeOf(creds.keyId),
            key_secret: { set: !!creds.keySecret, source: src(creds.sources.keySecret), last4: creds.sources.keySecret === "database" ? row?.key_secret_last4 ?? null : null },
            webhook_secret: { set: !!creds.webhookSecret, source: src(creds.sources.webhookSecret), last4: creds.sources.webhookSecret === "database" ? row?.webhook_secret_last4 ?? null : null },
            key_id_source: creds.sources.keyId,
            ready: !!(creds.keyId && creds.keySecret),
            webhook_ready: !!creds.webhookSecret,
            webhook_path: WEBHOOK_PATH,
            webhook_events: WEBHOOK_EVENTS,
            updated_at: row?.updated_at ?? null,
            updated_by_name: row?.updated_by_name ?? null,
            encryption_ready: secretBoxConfigured(),
        };
    },

    // Partial update: a blank field keeps what is already saved (secrets are never sent back to the page to re-submit).
    async set(body: { key_id?: unknown; key_secret?: unknown; webhook_secret?: unknown }, changedBy: string) {
        if (!secretBoxConfigured()) throw new AppError(503, "The server has no JWT_SECRET to encrypt keys with, so they can't be stored safely yet.", "PAYMENT_GATEWAY_NOT_CONFIGURED");

        const keyId = String(body.key_id ?? "").trim();
        const keySecret = String(body.key_secret ?? "").trim();
        const webhookSecret = String(body.webhook_secret ?? "").trim();
        if (!keyId && !keySecret && !webhookSecret) throw new AppError(400, "Enter at least one value to save.", "VALIDATION_ERROR");

        if (keyId && !/^rzp_(test|live)_[A-Za-z0-9]{6,}$/.test(keyId)) {
            throw new AppError(400, "Key ID should look like rzp_test_xxxxxxxx or rzp_live_xxxxxxxx.", "VALIDATION_ERROR");
        }
        if (keySecret && (keySecret.length < 10 || keySecret.length > 100 || /\s/.test(keySecret))) {
            throw new AppError(400, "That doesn't look like a Razorpay Key Secret.", "VALIDATION_ERROR");
        }
        if (webhookSecret && (webhookSecret.length < 8 || webhookSecret.length > 100 || /\s/.test(webhookSecret))) {
            throw new AppError(400, "Webhook secret must be 8-100 characters with no spaces.", "VALIDATION_ERROR");
        }

        // Verify the pair that will actually be in effect after this save.
        if (keyId || keySecret) {
            const current = await getRazorpayCredentials();
            const effectiveId = keyId || current.keyId;
            const effectiveSecret = keySecret || current.keySecret;
            if (!effectiveId || !effectiveSecret) throw new AppError(400, "Enter both the Key ID and the Key Secret.", "VALIDATION_ERROR");
            await verifyKeys(effectiveId, effectiveSecret);
        }

        await pool.query(
            `INSERT INTO platform_razorpay_settings (id, key_id, key_secret_enc, key_secret_last4, webhook_secret_enc, webhook_secret_last4, updated_by, updated_at)
             VALUES (TRUE, $1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (id) DO UPDATE SET
               key_id               = COALESCE($1, platform_razorpay_settings.key_id),
               key_secret_enc       = COALESCE($2, platform_razorpay_settings.key_secret_enc),
               key_secret_last4     = COALESCE($3, platform_razorpay_settings.key_secret_last4),
               webhook_secret_enc   = COALESCE($4, platform_razorpay_settings.webhook_secret_enc),
               webhook_secret_last4 = COALESCE($5, platform_razorpay_settings.webhook_secret_last4),
               updated_by = $6, updated_at = NOW()`,
            [
                keyId || null,
                keySecret ? encryptSecret(keySecret) : null, keySecret ? last4(keySecret) : null,
                webhookSecret ? encryptSecret(webhookSecret) : null, webhookSecret ? last4(webhookSecret) : null,
                changedBy,
            ]
        );
        invalidateRazorpayCredentials();
        logger.info("[payment-gateway] Razorpay settings saved", { changedBy, keyId: !!keyId, keySecret: !!keySecret, webhookSecret: !!webhookSecret });
        return this.getStatus();
    },

    // Super Admin only (the route sits behind superAdminMiddleware): the values in effect right now, in clear text, so
    // they can be checked and copied. Kept out of getStatus so the normal status response never carries a secret.
    async reveal(requestedBy: string) {
        const c = await getRazorpayCredentials();
        logger.info("[payment-gateway] Razorpay credentials viewed by super admin", { requestedBy });
        return { key_id: c.keyId, key_secret: c.keySecret, webhook_secret: c.webhookSecret };
    },

    // Re-checks whatever is in effect right now (database or environment).
    async test() {
        const { keyId, keySecret } = await getRazorpayCredentials();
        if (!keyId || !keySecret) throw new AppError(400, "No Razorpay keys are set yet.", "VALIDATION_ERROR");
        await verifyKeys(keyId, keySecret);
        return { ok: true, mode: modeOf(keyId) };
    },

    // Removes the database copy; the environment variables (if any) take over again.
    async clear(changedBy: string) {
        await pool.query(`DELETE FROM platform_razorpay_settings WHERE id = TRUE`).catch((err: any) => { if (err?.code !== "42P01") throw err; });
        invalidateRazorpayCredentials();
        logger.info("[payment-gateway] Razorpay settings removed", { changedBy });
        return this.getStatus();
    },
};
