import pool from "../../config/database";

export const PLAN_SLUGS = ["basic", "advance", "growth"] as const;
export type PlanSlug = (typeof PLAN_SLUGS)[number];

let ensured = false;

// Same SQL as Migration/create_module_plans.sql — run once per process so a database that
// hasn't had the migration applied yet still works.
async function ensureTable() {
    if (ensured) return;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS module_plans (
            slug            VARCHAR(20)  PRIMARY KEY,
            name            VARCHAR(50)  NOT NULL,
            sort_order      INT          NOT NULL DEFAULT 0,
            locked_modules  JSONB        NOT NULL DEFAULT '[]'::jsonb,
            configured      BOOLEAN      NOT NULL DEFAULT FALSE,
            updated_by      UUID         REFERENCES users(id) ON DELETE SET NULL,
            updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        INSERT INTO module_plans (slug, name, sort_order) VALUES
            ('basic', 'Basic', 1), ('advance', 'Advance', 2), ('growth', 'Growth', 3)
        ON CONFLICT (slug) DO NOTHING
    `);
    ensured = true;
}

export const modulePlansRepository = {
    async list() {
        await ensureTable();
        const { rows } = await pool.query(
            `SELECT p.slug, p.name, p.sort_order, p.locked_modules, p.configured, p.updated_at,
                    TRIM(CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))) AS updated_by_name
             FROM module_plans p
             LEFT JOIN users u ON u.id = p.updated_by
             ORDER BY p.sort_order ASC`
        );
        return rows;
    },

    async save(slug: PlanSlug, locked: string[], updatedBy: string) {
        await ensureTable();
        const { rows } = await pool.query(
            `UPDATE module_plans
             SET locked_modules = $2::jsonb, configured = TRUE, updated_by = $3, updated_at = NOW()
             WHERE slug = $1
             RETURNING slug`,
            [slug, JSON.stringify(locked), updatedBy]
        );
        return rows[0] ?? null;
    },
};
