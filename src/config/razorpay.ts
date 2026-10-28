import Razorpay from "razorpay";
import pool from "./database";
import logger from "./logger";
import { AppError } from "../middleware/error.middleware";
import { decryptSecret } from "../modules/ai-credentials/secret-box";

// Razorpay credentials are platform-wide. Super Admin saves them in the DB (platform_razorpay_settings, secrets encrypted);
// the RAZORPAY_* environment variables remain as a fallback, field by field, so an existing deployment keeps working.

export type RazorpaySource = "database" | "environment" | null;
export type RazorpayCredentials = {
    keyId: string | null;
    keySecret: string | null;
    webhookSecret: string | null;
    sources: { keyId: RazorpaySource; keySecret: RazorpaySource; webhookSecret: RazorpaySource };
};

const CACHE_TTL_MS = 30_000;
let cache: { creds: RazorpayCredentials; expiresAt: number } | null = null;
let client: { key: string; instance: Razorpay } | null = null;
let warnedMissingTable = false;

/** Call after the stored credentials change so the next request picks them up straight away. */
export function invalidateRazorpayCredentials() {
    cache = null;
    client = null;
}

const safeDecrypt = (field: string, enc: string | null | undefined): string | null => {
    if (!enc) return null;
    try {
        return decryptSecret(enc);
    } catch (err: any) {
        // Wrong/changed JWT_SECRET or a damaged value: behave as "not set in the database" and fall back to the env var.
        logger.error("[razorpay] could not decrypt a saved credential", { field, error: err?.message });
        return null;
    }
};

export async function getRazorpayCredentials(): Promise<RazorpayCredentials> {
    if (cache && cache.expiresAt > Date.now()) return cache.creds;

    let row: any = null;
    try {
        row = (await pool.query(`SELECT key_id, key_secret_enc, webhook_secret_enc FROM platform_razorpay_settings WHERE id = TRUE`)).rows[0] ?? null;
    } catch (err: any) {
        if (err?.code !== "42P01") throw err;
        if (!warnedMissingTable) {
            warnedMissingTable = true;
            logger.warn("platform_razorpay_settings table missing: using the RAZORPAY_* environment variables until the migration is run");
        }
    }

    const pick = (db: string | null | undefined, env: string | undefined): [string | null, RazorpaySource] =>
        db ? [db, "database"] : env ? [env, "environment"] : [null, null];

    const [keyId, keyIdSrc] = pick(row?.key_id, process.env.RAZORPAY_KEY_ID);
    const [keySecret, keySecretSrc] = pick(safeDecrypt("key_secret", row?.key_secret_enc), process.env.RAZORPAY_KEY_SECRET);
    const [webhookSecret, webhookSrc] = pick(safeDecrypt("webhook_secret", row?.webhook_secret_enc), process.env.RAZORPAY_WEBHOOK_SECRET);

    const creds: RazorpayCredentials = {
        keyId, keySecret, webhookSecret,
        sources: { keyId: keyIdSrc, keySecret: keySecretSrc, webhookSecret: webhookSrc },
    };
    cache = { creds, expiresAt: Date.now() + CACHE_TTL_MS };
    return creds;
}

// Built lazily so the app still boots (and every non-payment feature works) when the keys aren't set.
export async function getRazorpay(): Promise<Razorpay> {
    const { keyId, keySecret } = await getRazorpayCredentials();
    if (!keyId || !keySecret) {
        throw new AppError(503, "Razorpay is not configured. A Super Admin can add the keys under Plans > Payment Gateway.", "RAZORPAY_NOT_CONFIGURED");
    }
    const key = `${keyId}:${keySecret}`;
    if (!client || client.key !== key) client = { key, instance: new Razorpay({ key_id: keyId, key_secret: keySecret }) };
    return client.instance;
}

export type RazorpayPeriod = "monthly" | "yearly";

// Razorpay has no "quarterly" period: a quarter is a monthly plan billed every 3 months (interval 3).
export const razorpayBilling = (cycle: "monthly" | "quarterly" | "yearly"): { period: RazorpayPeriod; interval: number } =>
    cycle === "yearly" ? { period: "yearly", interval: 1 } : { period: "monthly", interval: cycle === "quarterly" ? 3 : 1 };

// Razorpay plans are immutable (the amount can never be edited), so every price change is a new plan.
// `amountRupees` is converted to paise here — the one place that conversion happens.
export async function createRazorpayPlan(opts: {
    name: string;
    description: string;
    period: RazorpayPeriod;
    interval: number;
    amountRupees: number;
}): Promise<string> {
    try {
        const plan = await (await getRazorpay()).plans.create({
            period: opts.period,
            interval: opts.interval,
            item: {
                name: opts.name,
                description: opts.description,
                amount: Math.round(opts.amountRupees * 100),
                currency: "INR",
            },
        });
        return plan.id;
    } catch (err: any) {
        if (err instanceof AppError) throw err;
        const detail = err?.error?.description ?? err?.message ?? "unknown error";
        throw new AppError(502, `Razorpay could not create the plan: ${detail}`, "RAZORPAY_ERROR");
    }
}
