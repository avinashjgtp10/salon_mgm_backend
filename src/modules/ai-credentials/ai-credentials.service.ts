import axios from "axios";
import pool from "../../config/database";
import config from "../../config/env";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { isModuleLocked } from "../../middleware/moduleLock.middleware";
import { decryptSecret, encryptSecret, secretBoxConfigured } from "./secret-box";

// Per-salon Cloudflare Workers AI credentials for LUNOX. A salon WITH a row has LUNOX; a salon without one doesn't
// (buttons stay visible, clicking shows the "Upgrade your plan" popup). The token is stored encrypted and is never
// returned by any API — only whether it is set and its last 4 characters.

export type SalonAiCredentials = { accountId: string; apiToken: string };

export const LUNOX_LOCKED_MESSAGE = "Your plan doesn't include LUNOX. Upgrade your plan to take control of it.";
export const lunoxLockedError = () => new AppError(403, LUNOX_LOCKED_MESSAGE, "MODULE_LOCKED", { module: "lunox" });

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { creds: SalonAiCredentials | null; expiresAt: number }>();
let warnedMissingTable = false;

async function load(salonId: string): Promise<SalonAiCredentials | null> {
    const hit = cache.get(salonId);
    if (hit && hit.expiresAt > Date.now()) return hit.creds;

    let creds: SalonAiCredentials | null = null;
    try {
        const { rows } = await pool.query(`SELECT cf_account_id, cf_api_token_enc FROM salon_ai_credentials WHERE salon_id = $1`, [salonId]);
        if (rows[0]) {
            try {
                creds = { accountId: rows[0].cf_account_id, apiToken: decryptSecret(rows[0].cf_api_token_enc) };
            } catch (err: any) {
                // Wrong/missing master key or a damaged value: behave as "not enabled" rather than leak or crash.
                logger.error("[ai-credentials] could not decrypt a salon's AI token", { salonId, error: err?.message });
            }
        }
    } catch (err: any) {
        if (err?.code !== "42P01") throw err;
        if (!warnedMissingTable) {
            warnedMissingTable = true;
            logger.warn("salon_ai_credentials table missing — LUNOX stays locked for every salon until the migration is run");
        }
    }
    cache.set(salonId, { creds, expiresAt: Date.now() + CACHE_TTL_MS });
    return creds;
}

const invalidate = (salonId: string) => cache.delete(salonId);

/** The salon's credentials, or throws the standard "Upgrade your plan" error. */
export async function requireSalonAiCredentials(salonId: string | null | undefined): Promise<SalonAiCredentials> {
    const creds = salonId && !(await isModuleLocked(salonId, "lunox")) ? await load(salonId) : null;
    if (!creds) throw lunoxLockedError();
    return creds;
}

// On only when the plan's "lunox" module is unlocked AND the salon has its credentials saved.
export const isLunoxEnabled = async (salonId: string | null | undefined): Promise<boolean> =>
    !!salonId && !(await isModuleLocked(salonId, "lunox")) && !!(await load(salonId));

// One tiny real call, so a typo'd account id or a token without Workers AI access is caught when it is saved.
async function verifyCredentials(accountId: string, apiToken: string): Promise<void> {
    try {
        await axios.post(
            `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`,
            { model: config.cloudflare.textModel, messages: [{ role: "user", content: "Reply with: ok" }], max_tokens: 64 },
            { headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" }, timeout: 30_000 }
        );
    } catch (err: any) {
        const status = err?.response?.status;
        logger.warn("[ai-credentials] verification call failed", { status });
        if (status === 401 || status === 403) throw new AppError(400, "Cloudflare rejected this token. Check that it has Workers AI access for this account.", "VALIDATION_ERROR");
        if (status === 404) throw new AppError(400, "Cloudflare could not find that Account ID.", "VALIDATION_ERROR");
        if (status === 429) return; // key is valid, the free allowance is just used up right now
        throw new AppError(502, "Could not reach Cloudflare to check the key. Try again.", "UPSTREAM_ERROR");
    }
}

export const aiCredentialsService = {
    async getStatus(salonId: string) {
        if (!salonId) throw new AppError(400, "Salon ID required", "VALIDATION_ERROR");
        const salon = await pool.query(`SELECT id, business_name FROM salons WHERE id = $1`, [salonId]);
        if (!salon.rows[0]) throw new AppError(404, "Salon not found", "NOT_FOUND");
        let row: any = null;
        try {
            row = (await pool.query(`SELECT cf_account_id, token_last4, updated_at FROM salon_ai_credentials WHERE salon_id = $1`, [salonId])).rows[0];
        } catch (err: any) {
            if (err?.code !== "42P01") throw err;
        }
        return {
            salon: salon.rows[0],
            configured: !!row,
            account_id: row?.cf_account_id ?? null,
            token_last4: row?.token_last4 ?? null,
            updated_at: row?.updated_at ?? null,
            encryption_ready: secretBoxConfigured(),
        };
    },

    // Super Admin only (the route sits behind superAdminMiddleware): the saved token in clear text, so it can be shown
    // and copied in the salon page. Kept out of getStatus so the normal status response never carries it.
    async reveal(salonId: string, requestedBy: string): Promise<{ api_token: string | null }> {
        const { rows } = await pool
            .query(`SELECT cf_api_token_enc FROM salon_ai_credentials WHERE salon_id = $1`, [salonId])
            .catch((err: any) => { if (err?.code === "42P01") return { rows: [] as any[] }; throw err; });
        if (!rows[0]) return { api_token: null };
        logger.info("[ai-credentials] LUNOX token viewed by super admin", { salonId, requestedBy });
        try {
            return { api_token: decryptSecret(rows[0].cf_api_token_enc) };
        } catch {
            throw new AppError(409, "The saved token can't be read any more (the server's JWT_SECRET changed). Paste the token again and save.", "AI_TOKEN_UNREADABLE");
        }
    },

    async set(salonId: string, body: { account_id?: unknown; api_token?: unknown }, changedBy: string) {
        if (!secretBoxConfigured()) throw new AppError(503, "The server has no JWT_SECRET to encrypt keys with, so they can't be stored safely yet.", "AI_NOT_CONFIGURED");
        const accountId = String(body.account_id ?? "").trim();
        const apiToken = String(body.api_token ?? "").trim();
        if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new AppError(400, "Account ID should be the 32-character id from the Cloudflare dashboard.", "VALIDATION_ERROR");
        if (apiToken.length < 20 || apiToken.length > 300 || /\s/.test(apiToken)) throw new AppError(400, "That doesn't look like a Cloudflare API token.", "VALIDATION_ERROR");
        const salon = await pool.query(`SELECT 1 FROM salons WHERE id = $1`, [salonId]);
        if (!salon.rows[0]) throw new AppError(404, "Salon not found", "NOT_FOUND");

        await verifyCredentials(accountId, apiToken);

        await pool.query(
            `INSERT INTO salon_ai_credentials (salon_id, cf_account_id, cf_api_token_enc, token_last4, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (salon_id) DO UPDATE
               SET cf_account_id = EXCLUDED.cf_account_id, cf_api_token_enc = EXCLUDED.cf_api_token_enc,
                   token_last4 = EXCLUDED.token_last4, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
            [salonId, accountId, encryptSecret(apiToken), apiToken.slice(-4), changedBy]
        );
        invalidate(salonId);
        logger.info("[ai-credentials] LUNOX key saved for salon", { salonId, changedBy });
        return this.getStatus(salonId);
    },

    async clear(salonId: string, changedBy: string) {
        await pool.query(`DELETE FROM salon_ai_credentials WHERE salon_id = $1`, [salonId]);
        invalidate(salonId);
        logger.info("[ai-credentials] LUNOX key removed for salon", { salonId, changedBy });
        return this.getStatus(salonId);
    },
};
