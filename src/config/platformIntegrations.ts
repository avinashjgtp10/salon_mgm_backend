import pool from "./database";
import logger from "./logger";
import config from "./env";
import { decryptSecret } from "../modules/ai-credentials/secret-box";

// Google sign-in and billing-email settings are platform-wide. Super Admin saves them in the DB
// (platform_integration_settings, secrets encrypted); the environment variables remain as a fallback, field by field,
// so an existing deployment keeps working with the table empty.

export type Source = "database" | "environment" | null;
export const INTEGRATION_FIELDS = [
    "google_client_id", "google_client_secret", "google_redirect_uri", "google_one_tap_client_id",
    "billing_email_from", "billing_smtp_user", "billing_smtp_pass",
] as const;
export type IntegrationField = (typeof INTEGRATION_FIELDS)[number];
export type IntegrationValues = Record<IntegrationField, string | null>;
export type IntegrationSettings = { values: IntegrationValues; sources: Record<IntegrationField, Source> };

const ENV_NAMES: Record<IntegrationField, string> = {
    google_client_id: "GOOGLE_CLIENT_ID",
    google_client_secret: "GOOGLE_CLIENT_SECRET",
    google_redirect_uri: "GOOGLE_REDIRECT_URI",
    google_one_tap_client_id: "GOOGLE_ONE_TAP_CLIENT_ID",
    billing_email_from: "EMAIL_FROM_BILLING",
    billing_smtp_user: "SMTP_BILLING_USER",
    billing_smtp_pass: "SMTP_BILLING_PASS",
};

// 30 seconds is the longest another server instance can keep using an old value; the instance that saves is refreshed at once.
const CACHE_TTL_MS = 30_000;
let cache: { settings: IntegrationSettings; expiresAt: number } | null = null;
let warnedMissingTable = false;

/** Call after the stored settings change so the next request picks them up straight away. */
export function invalidateIntegrationSettings() {
    cache = null;
}

const safeDecrypt = (field: string, enc: string | null | undefined): string | null => {
    if (!enc) return null;
    try {
        return decryptSecret(enc);
    } catch (err: any) {
        // Wrong/changed JWT_SECRET or a damaged value: behave as "not set in the database" and fall back to the env var.
        logger.error("[platform-integrations] could not decrypt a saved credential", { field, error: err?.message });
        return null;
    }
};

export async function getIntegrationSettings(): Promise<IntegrationSettings> {
    if (cache && cache.expiresAt > Date.now()) return cache.settings;

    let row: any = null;
    try {
        row = (await pool.query(`SELECT * FROM platform_integration_settings WHERE id = TRUE`)).rows[0] ?? null;
    } catch (err: any) {
        if (err?.code !== "42P01") throw err;
        if (!warnedMissingTable) {
            warnedMissingTable = true;
            logger.warn("platform_integration_settings table missing: using the GOOGLE_* / billing SMTP environment variables until the migration is run");
        }
    }

    const db: IntegrationValues = {
        google_client_id: row?.google_client_id ?? null,
        google_client_secret: safeDecrypt("google_client_secret", row?.google_client_secret_enc),
        google_redirect_uri: row?.google_redirect_uri ?? null,
        google_one_tap_client_id: row?.google_one_tap_client_id ?? null,
        billing_email_from: row?.billing_email_from ?? null,
        billing_smtp_user: row?.billing_smtp_user ?? null,
        billing_smtp_pass: safeDecrypt("billing_smtp_pass", row?.billing_smtp_pass_enc),
    };

    const values = {} as IntegrationValues;
    const sources = {} as Record<IntegrationField, Source>;
    for (const f of INTEGRATION_FIELDS) {
        const env = process.env[ENV_NAMES[f]]?.trim();
        if (db[f]) { values[f] = db[f]; sources[f] = "database"; }
        else if (env) { values[f] = env; sources[f] = "environment"; }
        else { values[f] = null; sources[f] = null; }
    }

    const settings = { values, sources };
    cache = { settings, expiresAt: Date.now() + CACHE_TTL_MS };
    return settings;
}

export async function getGoogleOAuthConfig() {
    const { values } = await getIntegrationSettings();
    return { clientId: values.google_client_id ?? "", clientSecret: values.google_client_secret ?? "", redirectUri: values.google_redirect_uri ?? "" };
}

/** The From address and (optional) own login used for payment / invoice / expiry-reminder mail. */
export async function getBillingMailConfig() {
    const { values } = await getIntegrationSettings();
    return {
        from: values.billing_email_from ?? config.smtp.billingFrom,
        user: values.billing_smtp_user ?? "",
        pass: values.billing_smtp_pass ?? "",
    };
}
