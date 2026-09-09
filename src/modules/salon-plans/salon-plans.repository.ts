import pool from "../../config/database";
import {
    PlanTier,
    SalonPlanDefinition,
    UpdatePlanDefinitionBody,
    SalonPlanCustomization,
    UpsertSalonCustomizationBody,
    SalonPlanInvoice,
    CreateInvoiceBody,
    ListInvoicesFilters,
    SalonCustomizationListRow,
} from "./salon-plans.types";

// ─── Plan Definitions (the 3 fixed tiers) ──────────────────────────────────────

export const planDefinitionsRepository = {
    async findAll(): Promise<SalonPlanDefinition[]> {
        const { rows } = await pool.query(
            `SELECT * FROM salon_plan_definitions ORDER BY price ASC`
        );
        return rows;
    },

    async findByTier(tier: PlanTier): Promise<SalonPlanDefinition | null> {
        const { rows } = await pool.query(
            `SELECT * FROM salon_plan_definitions WHERE tier = $1`, [tier]
        );
        return rows[0] || null;
    },

    // No insert/delete — the 3 rows are seeded once by the migration and are
    // permanent (enforced by the table's own CHECK constraint on tier).
    async update(tier: PlanTier, patch: UpdatePlanDefinitionBody, updatedBy: string): Promise<SalonPlanDefinition | null> {
        const keys = Object.keys(patch) as (keyof UpdatePlanDefinitionBody)[];
        if (keys.length === 0) return planDefinitionsRepository.findByTier(tier);

        const jsonbFields = new Set(["features", "feature_keys"]);
        const setParts: string[] = [];
        const values: unknown[] = [];
        keys.forEach((k) => {
            const isJsonb = jsonbFields.has(k);
            const value = isJsonb ? JSON.stringify((patch as Record<string, unknown>)[k]) : (patch as Record<string, unknown>)[k];
            values.push(value);
            setParts.push(isJsonb ? `${k} = $${values.length}::jsonb` : `${k} = $${values.length}`);
        });
        setParts.push(`updated_by = $${values.length + 1}`);
        values.push(updatedBy);
        setParts.push(`updated_at = NOW()`);
        values.push(tier);

        const { rows } = await pool.query(
            `UPDATE salon_plan_definitions SET ${setParts.join(", ")} WHERE tier = $${values.length} RETURNING *`,
            values
        );
        return rows[0] || null;
    },

    // Links this tier to a real subscription_plans row (see
    // Migration/add_razorpay_link_to_salon_plans.sql) so the salon-facing
    // checkout button can create a live Razorpay subscription against it.
    async setLinkedSubscriptionPlan(tier: PlanTier, subscriptionPlanId: string, updatedBy: string): Promise<SalonPlanDefinition | null> {
        const { rows } = await pool.query(
            `UPDATE salon_plan_definitions SET linked_subscription_plan_id = $1, updated_by = $2, updated_at = NOW() WHERE tier = $3 RETURNING *`,
            [subscriptionPlanId, updatedBy, tier]
        );
        return rows[0] || null;
    },
};

// ─── Salon Customizations ───────────────────────────────────────────────────────

export const salonCustomizationsRepository = {
    async findBySalonId(salonId: string): Promise<SalonPlanCustomization | null> {
        const { rows } = await pool.query(
            `SELECT * FROM salon_plan_customizations WHERE salon_id = $1`, [salonId]
        );
        return rows[0] || null;
    },

    async search(query?: string): Promise<SalonCustomizationListRow[]> {
        const params: unknown[] = [];
        let where = "";
        if (query) {
            params.push(`%${query}%`);
            where = `WHERE COALESCE(s.business_name, s.slug, '') ILIKE $1 OR u.email ILIKE $1`;
        }

        const { rows } = await pool.query(
            `SELECT
        spc.*,
        COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name,
        u.email AS owner_email,
        spd.default_staff_limit, spd.default_customer_limit, spd.default_appointment_limit,
        spd.default_branch_limit, spd.default_storage_limit_gb
      FROM salon_plan_customizations spc
      JOIN salons s ON s.id = spc.salon_id
      LEFT JOIN users u ON u.id = s.owner_id
      JOIN salon_plan_definitions spd ON spd.tier = spc.base_tier
      ${where}
      ORDER BY s.business_name ASC NULLS LAST`,
            params
        );

        // is_customized: true whenever any field the admin can override
        // actually departs from that base tier's own defaults.
        return rows.map((r) => {
            const isCustomized =
                r.custom_price !== null ||
                Object.keys(r.feature_overrides ?? {}).length > 0 ||
                r.staff_limit !== r.default_staff_limit ||
                r.customer_limit !== r.default_customer_limit ||
                r.appointment_limit !== r.default_appointment_limit ||
                r.branch_limit !== r.default_branch_limit ||
                r.storage_limit_gb !== r.default_storage_limit_gb;
            const {
                default_staff_limit, default_customer_limit, default_appointment_limit,
                default_branch_limit, default_storage_limit_gb, ...row
            } = r;
            return { ...row, is_customized: isCustomized };
        });
    },

    // One row per salon (UNIQUE salon_id) — an admin re-saving the same
    // salon's customization always updates that one row, never creates a
    // second. NULL limit fields fall back to the new base_tier's defaults
    // (via COALESCE against salon_plan_definitions) only when the caller
    // omits them entirely — an explicit null in the payload always means
    // "unlimited", handled by the service layer before this is called.
    async upsert(salonId: string, body: UpsertSalonCustomizationBody, updatedBy: string): Promise<SalonPlanCustomization> {
        const { rows } = await pool.query(
            `INSERT INTO salon_plan_customizations (
        salon_id, base_tier, custom_price,
        staff_limit, customer_limit, appointment_limit, branch_limit, storage_limit_gb,
        feature_overrides, start_date, expiry_date, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, COALESCE($10, CURRENT_DATE), $11, $12)
      ON CONFLICT (salon_id) DO UPDATE SET
        base_tier          = EXCLUDED.base_tier,
        custom_price       = EXCLUDED.custom_price,
        staff_limit        = EXCLUDED.staff_limit,
        customer_limit     = EXCLUDED.customer_limit,
        appointment_limit  = EXCLUDED.appointment_limit,
        branch_limit       = EXCLUDED.branch_limit,
        storage_limit_gb   = EXCLUDED.storage_limit_gb,
        feature_overrides  = EXCLUDED.feature_overrides,
        start_date         = EXCLUDED.start_date,
        expiry_date        = EXCLUDED.expiry_date,
        updated_by         = EXCLUDED.updated_by,
        updated_at         = NOW()
      RETURNING *`,
            [
                salonId,
                body.base_tier,
                body.custom_price ?? null,
                body.staff_limit ?? null,
                body.customer_limit ?? null,
                body.appointment_limit ?? null,
                body.branch_limit ?? null,
                body.storage_limit_gb ?? null,
                JSON.stringify(body.feature_overrides ?? {}),
                body.start_date ?? null,
                body.expiry_date ?? null,
                updatedBy,
            ]
        );
        return rows[0];
    },

    async remove(salonId: string): Promise<boolean> {
        const { rowCount } = await pool.query(
            `DELETE FROM salon_plan_customizations WHERE salon_id = $1`, [salonId]
        );
        return (rowCount ?? 0) > 0;
    },
};

// ─── Invoices ────────────────────────────────────────────────────────────────

function nextInvoiceNumber(): string {
    // INV-<year>-<random 6-digit> — collisions are astronomically unlikely
    // and the UNIQUE constraint on invoice_number is the actual guarantee;
    // this is just a human-readable format, not a strict sequence.
    const year = new Date().getFullYear();
    const rand = Math.floor(100000 + Math.random() * 900000);
    return `INV-${year}-${rand}`;
}

export const salonPlanInvoicesRepository = {
    async list(filters: ListInvoicesFilters): Promise<{ data: (SalonPlanInvoice & { salon_name: string })[]; total: number }> {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (filters.salon_id) { conditions.push(`spi.salon_id = $${idx++}`); values.push(filters.salon_id); }
        if (filters.status) { conditions.push(`spi.status = $${idx++}`); values.push(filters.status); }
        if (filters.search) {
            conditions.push(`(spi.invoice_number ILIKE $${idx} OR COALESCE(s.business_name, s.slug, '') ILIKE $${idx})`);
            values.push(`%${filters.search}%`);
            idx++;
        }
        const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const offset = (page - 1) * limit;

        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*)::int AS total
       FROM salon_plan_invoices spi
       JOIN salons s ON s.id = spi.salon_id
       ${where}`,
            values
        );

        const { rows } = await pool.query(
            `SELECT spi.*, COALESCE(s.business_name, s.slug, 'Unnamed') AS salon_name
       FROM salon_plan_invoices spi
       JOIN salons s ON s.id = spi.salon_id
       ${where}
       ORDER BY spi.issued_date DESC, spi.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
            [...values, limit, offset]
        );
        return { data: rows, total: countRows[0]?.total ?? 0 };
    },

    async summary(): Promise<{ total: number; collected: number; outstanding: number }> {
        const { rows } = await pool.query(
            `SELECT
        COALESCE(SUM(amount), 0)::float AS total,
        COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::float AS collected,
        COALESCE(SUM(amount) FILTER (WHERE status IN ('open', 'overdue')), 0)::float AS outstanding
      FROM salon_plan_invoices`
        );
        return rows[0];
    },

    async create(body: CreateInvoiceBody, createdBy: string): Promise<SalonPlanInvoice> {
        const { rows } = await pool.query(
            `INSERT INTO salon_plan_invoices (invoice_number, salon_id, plan_tier, amount, status, issued_date, due_date, created_by)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7, $8)
       RETURNING *`,
            [
                nextInvoiceNumber(),
                body.salon_id,
                body.plan_tier,
                body.amount,
                body.status ?? "open",
                body.issued_date ?? null,
                body.due_date ?? null,
                createdBy,
            ]
        );
        return rows[0];
    },

    async updateStatus(id: string, status: string): Promise<SalonPlanInvoice | null> {
        const { rows } = await pool.query(
            `UPDATE salon_plan_invoices SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
            [status, id]
        );
        return rows[0] || null;
    },
};
