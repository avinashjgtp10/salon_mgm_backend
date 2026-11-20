import axios from "axios";
import nodemailer from "nodemailer";
import pool from "../../config/database";
import config from "../../config/env";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { getIntegrationSettings, invalidateIntegrationSettings, INTEGRATION_FIELDS, type IntegrationField } from "../../config/platformIntegrations";
import { encryptSecret, secretBoxConfigured } from "../ai-credentials/secret-box";

// Super Admin's global Google sign-in + billing-email settings. Secrets are stored encrypted and never returned by status:
// it only says whether each is set, where it comes from, and (for DB-stored ones) its last 4 characters.

const last4 = (s: string) => s.slice(-4);
const bad = (msg: string) => new AppError(400, msg, "VALIDATION_ERROR");

type Row = Record<string, any>;
async function loadRow(): Promise<Row | null> {
    try {
        const { rows } = await pool.query(
            `SELECT p.*, TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) AS updated_by_name
             FROM platform_integration_settings p LEFT JOIN users u ON u.id = p.updated_by WHERE p.id = TRUE`
        );
        return rows[0] ?? null;
    } catch (err: any) {
        if (err?.code === "42P01") return null;
        throw err;
    }
}

const ENV_NAMES: Record<IntegrationField, string> = {
    google_client_id: "GOOGLE_CLIENT_ID", google_client_secret: "GOOGLE_CLIENT_SECRET", google_redirect_uri: "GOOGLE_REDIRECT_URI",
    google_one_tap_client_id: "GOOGLE_ONE_TAP_CLIENT_ID", billing_email_from: "EMAIL_FROM_BILLING",
    billing_smtp_user: "SMTP_BILLING_USER", billing_smtp_pass: "SMTP_BILLING_PASS",
};

const GOOGLE_ID_RE = /^[0-9A-Za-z._-]+\.apps\.googleusercontent\.com$/;

// A deliberately wrong authorization code: Google answers "invalid_grant" when the client id + secret + redirect URI are
// accepted (only the code is bad) and "invalid_client" when the id/secret are wrong. Network trouble is not a verdict.
async function checkGoogleClient(clientId: string, clientSecret: string, redirectUri: string): Promise<"ok" | "unreachable"> {
    try {
        await axios.post(
            "https://oauth2.googleapis.com/token",
            new URLSearchParams({ code: "salonox-credential-check", client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }).toString(),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 8000 }
        );
        return "ok";
    } catch (err: any) {
        const code = err?.response?.data?.error;
        if (code === "invalid_client") throw bad("Google rejected this Client ID / Client Secret. Check they belong to the same OAuth client.");
        if (code === "invalid_grant" || code === "redirect_uri_mismatch" || code === "invalid_request") return "ok";
        logger.warn("[platform-integrations] could not reach Google to check the client", { error: err?.message });
        return "unreachable";
    }
}

async function checkBillingSmtp(user: string, pass: string): Promise<void> {
    try {
        await nodemailer.createTransport({
            host: config.smtp.host, port: config.smtp.port, secure: false, requireTLS: true,
            auth: { user, pass }, connectionTimeout: 10000, greetingTimeout: 10000,
        }).verify();
    } catch (err: any) {
        logger.warn("[platform-integrations] billing SMTP verification failed", { error: err?.message });
        if (err?.code === "EAUTH") throw bad("The mail server rejected this billing username / password. For Gmail use an App Password.");
        throw new AppError(424, `Could not log in to the mail server to check these: ${err?.message ?? "unknown error"}`, "UPSTREAM_ERROR");
    }
}

export const platformIntegrationsService = {
    async getStatus() {
        const [row, s] = await Promise.all([loadRow(), getIntegrationSettings()]);
        const plain = (f: IntegrationField) => ({ value: s.values[f], source: s.sources[f] });
        const secret = (f: "google_client_secret" | "billing_smtp_pass", lastCol: string) => ({
            set: !!s.values[f], source: s.sources[f], last4: s.sources[f] === "database" ? row?.[lastCol] ?? null : null,
        });
        return {
            google: {
                client_id: plain("google_client_id"),
                client_secret: secret("google_client_secret", "google_client_secret_last4"),
                redirect_uri: plain("google_redirect_uri"),
                one_tap_client_id: plain("google_one_tap_client_id"),
                ready: !!(s.values.google_client_id && s.values.google_client_secret && s.values.google_redirect_uri),
            },
            billing_email: {
                from: plain("billing_email_from"),
                smtp_user: plain("billing_smtp_user"),
                smtp_pass: secret("billing_smtp_pass", "billing_smtp_pass_last4"),
                // Without its own login the main SMTP account sends, and the provider may replace the From address.
                own_login: !!(s.values.billing_smtp_user && s.values.billing_smtp_pass),
                default_from: config.smtp.billingFrom,
            },
            updated_at: row?.updated_at ?? null,
            updated_by_name: row?.updated_by_name ?? null,
            encryption_ready: secretBoxConfigured(),
        };
    },

    // Partial update: a blank field keeps what is already saved (secrets are never sent back to the page to re-submit).
    async set(body: Record<string, unknown>, changedBy: string) {
        if (!secretBoxConfigured()) throw new AppError(503, "The server has no JWT_SECRET to encrypt secrets with, so they can't be stored safely yet.", "PLATFORM_INTEGRATIONS_NOT_CONFIGURED");

        const v = {} as Record<IntegrationField, string>;
        // Tolerate values pasted straight from an .env file: "NAME=" prefix and straight or curly quotes around the value.
        const clean = (f: IntegrationField, raw: unknown) =>
            String(raw ?? "").trim().replace(new RegExp(`^${ENV_NAMES[f]}\\s*=\\s*`, "i"), "").replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
        for (const f of INTEGRATION_FIELDS) v[f] = clean(f, body[f]);
        if (!INTEGRATION_FIELDS.some((f) => v[f])) throw bad("Enter at least one value to save.");

        if (v.google_client_id && !GOOGLE_ID_RE.test(v.google_client_id)) throw bad("Google Client ID should end with .apps.googleusercontent.com.");
        if (v.google_one_tap_client_id && !GOOGLE_ID_RE.test(v.google_one_tap_client_id)) throw bad("Google One Tap Client ID should end with .apps.googleusercontent.com.");
        if (v.google_client_secret && (v.google_client_secret.length < 10 || v.google_client_secret.length > 200 || /\s/.test(v.google_client_secret))) throw bad("That doesn't look like a Google Client Secret.");
        if (v.google_redirect_uri) {
            let u: URL;
            try { u = new URL(v.google_redirect_uri); } catch { throw bad("Redirect URI must be a full URL, e.g. https://api.example.com/api/v1/auth/google/callback."); }
            if (u.protocol !== "https:" && u.protocol !== "http:") throw bad("Redirect URI must start with https:// (or http:// for local testing).");
            if (!u.pathname.endsWith("/auth/google/callback")) throw bad("Redirect URI should end with /api/v1/auth/google/callback: that is where this server receives Google's reply.");
        }
        if (v.billing_email_from && !/^(?:[^<>\r\n]+<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(v.billing_email_from)) throw bad('Billing "From" should look like info@example.com or SalonOx Billing <info@example.com>.');
        if (v.billing_smtp_user && (v.billing_smtp_user.length > 255 || /\s/.test(v.billing_smtp_user))) throw bad("That doesn't look like a mail login.");
        if (v.billing_smtp_pass && (v.billing_smtp_pass.length < 4 || v.billing_smtp_pass.length > 200)) throw bad("That doesn't look like a mail password.");

        const cur = await getIntegrationSettings();
        const eff = (f: IntegrationField) => v[f] || cur.values[f] || "";

        // Verify the pairs that will actually be in effect after this save, so a typo is caught here and not at a customer's login.
        let googleUnchecked = false;
        if (v.google_client_id || v.google_client_secret || v.google_redirect_uri) {
            if (!eff("google_client_id") || !eff("google_client_secret")) throw bad("Enter both the Google Client ID and the Client Secret.");
            googleUnchecked = (await checkGoogleClient(eff("google_client_id"), eff("google_client_secret"), eff("google_redirect_uri") || "http://localhost/")) === "unreachable";
        }
        if (v.billing_smtp_user || v.billing_smtp_pass) {
            if (!eff("billing_smtp_user") || !eff("billing_smtp_pass")) throw bad("Enter both the billing mail username and password (or neither).");
            await checkBillingSmtp(eff("billing_smtp_user"), eff("billing_smtp_pass"));
        }

        await pool.query(
            `INSERT INTO platform_integration_settings (id, google_client_id, google_client_secret_enc, google_client_secret_last4, google_redirect_uri, google_one_tap_client_id,
                                                         billing_email_from, billing_smtp_user, billing_smtp_pass_enc, billing_smtp_pass_last4, updated_by, updated_at)
             VALUES (TRUE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
             ON CONFLICT (id) DO UPDATE SET
               google_client_id           = COALESCE($1, platform_integration_settings.google_client_id),
               google_client_secret_enc   = COALESCE($2, platform_integration_settings.google_client_secret_enc),
               google_client_secret_last4 = COALESCE($3, platform_integration_settings.google_client_secret_last4),
               google_redirect_uri        = COALESCE($4, platform_integration_settings.google_redirect_uri),
               google_one_tap_client_id   = COALESCE($5, platform_integration_settings.google_one_tap_client_id),
               billing_email_from         = COALESCE($6, platform_integration_settings.billing_email_from),
               billing_smtp_user          = COALESCE($7, platform_integration_settings.billing_smtp_user),
               billing_smtp_pass_enc      = COALESCE($8, platform_integration_settings.billing_smtp_pass_enc),
               billing_smtp_pass_last4    = COALESCE($9, platform_integration_settings.billing_smtp_pass_last4),
               updated_by = $10, updated_at = NOW()`,
            [
                v.google_client_id || null,
                v.google_client_secret ? encryptSecret(v.google_client_secret) : null, v.google_client_secret ? last4(v.google_client_secret) : null,
                v.google_redirect_uri || null, v.google_one_tap_client_id || null,
                v.billing_email_from || null, v.billing_smtp_user || null,
                v.billing_smtp_pass ? encryptSecret(v.billing_smtp_pass) : null, v.billing_smtp_pass ? last4(v.billing_smtp_pass) : null,
                changedBy,
            ]
        );
        invalidateIntegrationSettings();
        // Field names only, never values.
        logger.info("[platform-integrations] settings saved", { changedBy, fields: INTEGRATION_FIELDS.filter((f) => v[f]) });
        return { ...(await this.getStatus()), google_unchecked: googleUnchecked };
    },

    // Super Admin only (the route sits behind superAdminMiddleware): values in effect right now, in clear text.
    async reveal(requestedBy: string) {
        const { values } = await getIntegrationSettings();
        logger.info("[platform-integrations] credentials viewed by super admin", { requestedBy });
        return values;
    },

    async testGoogle() {
        const { values: v } = await getIntegrationSettings();
        if (!v.google_client_id || !v.google_client_secret) throw bad("No Google Client ID / Secret is set yet.");
        const r = await checkGoogleClient(v.google_client_id, v.google_client_secret, v.google_redirect_uri || "http://localhost/");
        if (r === "unreachable") throw new AppError(424, "Could not reach Google to check the credentials. Try again.", "UPSTREAM_ERROR");
        return { ok: true };
    },

    async testBilling() {
        const { values: v } = await getIntegrationSettings();
        if (!v.billing_smtp_user || !v.billing_smtp_pass) throw bad("No billing mail login is set: billing mail is sent with the main mail account.");
        await checkBillingSmtp(v.billing_smtp_user, v.billing_smtp_pass);
        return { ok: true };
    },

    // Removes the database copy of one section; the environment variables (if any) take over again.
    async clear(section: string, changedBy: string) {
        const cols: Record<string, string[]> = {
            google: ["google_client_id", "google_client_secret_enc", "google_client_secret_last4", "google_redirect_uri", "google_one_tap_client_id"],
            billing: ["billing_email_from", "billing_smtp_user", "billing_smtp_pass_enc", "billing_smtp_pass_last4"],
        };
        if (!cols[section]) throw bad("Unknown section.");
        await pool.query(`UPDATE platform_integration_settings SET ${cols[section].map((c) => `${c} = NULL`).join(", ")}, updated_by = $1, updated_at = NOW() WHERE id = TRUE`, [changedBy])
            .catch((err: any) => { if (err?.code !== "42P01") throw err; });
        invalidateIntegrationSettings();
        logger.info("[platform-integrations] saved settings removed", { changedBy, section });
        return this.getStatus();
    },
};
