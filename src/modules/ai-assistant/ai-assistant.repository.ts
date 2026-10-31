import pool from "../../config/database";

// Table lives in Migration/add_ai_assistant.sql — run by hand, never auto-created.
export const aiAssistantRepository = {
    async logUsage(p: { salonId: string; userId: string; kind: "chat" | "image"; model: string; tokens: number }) {
        await pool.query(
            `INSERT INTO ai_usage (salon_id, user_id, kind, model, tokens) VALUES ($1, $2, $3, $4, $5)`,
            [p.salonId, p.userId, p.kind, p.model, p.tokens]
        );
    },

    async requestsInLastMinute(userId: string): Promise<number> {
        const { rows } = await pool.query(
            `SELECT COUNT(*)::int AS n FROM ai_usage WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 minute'`,
            [userId]
        );
        return rows[0].n;
    },

    async tokensThisMonth(salonId: string): Promise<number> {
        const { rows } = await pool.query(
            `SELECT COALESCE(SUM(tokens), 0)::bigint AS n FROM ai_usage
             WHERE salon_id = $1 AND created_at >= date_trunc('month', NOW())`,
            [salonId]
        );
        return Number(rows[0].n);
    },

    async imagesToday(salonId: string): Promise<number> {
        const { rows } = await pool.query(
            `SELECT COUNT(*)::int AS n FROM ai_usage WHERE salon_id = $1 AND kind = 'image' AND created_at >= date_trunc('day', NOW())`,
            [salonId]
        );
        return rows[0].n;
    },

    async insertAsset(p: { salonId: string; userId: string; brief: string; format: string; imageUrl: string; copy: unknown }): Promise<string> {
        const { rows } = await pool.query(
            `INSERT INTO ai_generated_assets (salon_id, user_id, brief, format, image_url, copy)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [p.salonId, p.userId, p.brief, p.format, p.imageUrl, JSON.stringify(p.copy)]
        );
        return rows[0].id;
    },

    async listAssets(salonId: string, limit = 10) {
        const { rows } = await pool.query(
            `SELECT id, brief, format, image_url, copy, created_at FROM ai_generated_assets
             WHERE salon_id = $1 ORDER BY created_at DESC LIMIT $2`,
            [salonId, limit]
        );
        return rows;
    },
};
