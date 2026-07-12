import pool from "../../config/database";
import { AiAgentLog, AiCustomerMemory } from "./ai-engine.types";

export async function ensureTable(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_customer_memory (
            id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            salon_id            UUID         NOT NULL,
            client_id           UUID,
            phone               VARCHAR(32)  NOT NULL,
            preferred_staff_id  UUID,
            preferred_language  VARCHAR(50),
            notes               TEXT,
            birthday            DATE,
            created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            UNIQUE (salon_id, phone)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_agent_logs (
            id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            salon_id         UUID         NOT NULL,
            phone            VARCHAR(32)  NOT NULL,
            user_message     TEXT         NOT NULL,
            tool_calls       JSONB        NOT NULL DEFAULT '[]',
            assistant_reply  TEXT         NOT NULL DEFAULT '',
            latency_ms       INT          NOT NULL DEFAULT 0,
            created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE whatsapp_configs
        ADD COLUMN IF NOT EXISTS ai_receptionist_enabled BOOLEAN NOT NULL DEFAULT false
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_token_usage (
            id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            salon_id          UUID         NOT NULL,
            model             VARCHAR(100) NOT NULL,
            prompt_tokens     INT          NOT NULL DEFAULT 0,
            completion_tokens INT          NOT NULL DEFAULT 0,
            total_tokens      INT          NOT NULL DEFAULT 0,
            created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    `);
}

export const aiEngineRepository = {
    async getMemory(salonId: string, phone: string): Promise<AiCustomerMemory | null> {
        const { rows } = await pool.query(
            `SELECT * FROM ai_customer_memory WHERE salon_id = $1 AND phone = $2 LIMIT 1`,
            [salonId, phone]
        );
        return rows[0] || null;
    },

    // notes appends rather than overwrites — each new fact learned in conversation
    // is added to what's already known, instead of replacing it.
    async upsertMemory(params: {
        salonId: string;
        phone: string;
        clientId?: string | null;
        preferredStaffId?: string | null;
        preferredLanguage?: string | null;
        birthday?: string | null;
        notes?: string | null;
    }): Promise<AiCustomerMemory> {
        const { rows } = await pool.query(
            `INSERT INTO ai_customer_memory
                (salon_id, phone, client_id, preferred_staff_id, preferred_language, birthday, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (salon_id, phone) DO UPDATE SET
                client_id           = COALESCE(EXCLUDED.client_id, ai_customer_memory.client_id),
                preferred_staff_id  = COALESCE(EXCLUDED.preferred_staff_id, ai_customer_memory.preferred_staff_id),
                preferred_language  = COALESCE(EXCLUDED.preferred_language, ai_customer_memory.preferred_language),
                birthday             = COALESCE(EXCLUDED.birthday, ai_customer_memory.birthday),
                notes               = CASE
                                        WHEN EXCLUDED.notes IS NULL THEN ai_customer_memory.notes
                                        WHEN ai_customer_memory.notes IS NULL THEN EXCLUDED.notes
                                        ELSE ai_customer_memory.notes || E'\n' || EXCLUDED.notes
                                      END,
                updated_at          = NOW()
             RETURNING *`,
            [
                params.salonId,
                params.phone,
                params.clientId ?? null,
                params.preferredStaffId ?? null,
                params.preferredLanguage ?? null,
                params.birthday ?? null,
                params.notes ?? null,
            ]
        );
        return rows[0];
    },

    async logInteraction(params: {
        salonId: string;
        phone: string;
        userMessage: string;
        toolCalls: unknown;
        assistantReply: string;
        latencyMs: number;
    }): Promise<AiAgentLog> {
        const { rows } = await pool.query(
            `INSERT INTO ai_agent_logs
                (salon_id, phone, user_message, tool_calls, assistant_reply, latency_ms)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [
                params.salonId,
                params.phone,
                params.userMessage,
                JSON.stringify(params.toolCalls),
                params.assistantReply,
                params.latencyMs,
            ]
        );
        return rows[0];
    },

    async isAiReceptionistEnabled(salonId: string): Promise<boolean> {
        const { rows } = await pool.query(
            `SELECT ai_receptionist_enabled FROM whatsapp_configs WHERE salon_id = $1 LIMIT 1`,
            [salonId]
        );
        return rows[0]?.ai_receptionist_enabled === true;
    },

    // One row per raw LLM call (a single conversation turn can make several,
    // once per tool-calling iteration) — kept separate from ai_agent_logs so
    // usage tracking doesn't depend on that (currently unused) per-turn log.
    async logTokenUsage(params: {
        salonId: string;
        model: string;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    }): Promise<void> {
        await pool.query(
            `INSERT INTO ai_token_usage (salon_id, model, prompt_tokens, completion_tokens, total_tokens)
             VALUES ($1, $2, $3, $4, $5)`,
            [params.salonId, params.model, params.promptTokens, params.completionTokens, params.totalTokens]
        );
    },

    // Cumulative burn — overall if salonId is omitted, per-salon otherwise.
    async getTokenUsageSummary(salonId?: string): Promise<{
        calls: number;
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    }> {
        const { rows } = await pool.query(
            `SELECT
                COUNT(*)::int                    AS calls,
                COALESCE(SUM(prompt_tokens), 0)::int     AS prompt_tokens,
                COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
                COALESCE(SUM(total_tokens), 0)::int      AS total_tokens
             FROM ai_token_usage
             ${salonId ? "WHERE salon_id = $1" : ""}`,
            salonId ? [salonId] : []
        );
        return rows[0];
    },
};
