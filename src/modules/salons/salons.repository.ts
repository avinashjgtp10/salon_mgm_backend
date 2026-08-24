import type { PoolClient } from "pg";
import pool from "../../config/database";
import { CreateSalonBody, UpdateSalonBody, Salon } from "./salons.types";

// Tables that carry a salon_id column but have NO foreign key constraint to
// salons(id) — ON DELETE CASCADE never fires for these, so their rows would
// be silently orphaned (left behind, pointing at a salon that no longer
// exists) unless deleted explicitly here.
//
// This list was verified directly against the live schema on 2026-08-24 via
// information_schema.table_constraints / referential_constraints (every
// table with a salon_id column, cross-checked against every FK referencing
// salons(id)) — not just inferred from code. It is not something to trust
// blind forever though: it must be re-checked the same way whenever a new
// salon-scoped table is added, since a table added after this list was last
// verified will silently orphan data exactly like the ones below used to.
const SALON_ORPHAN_RISK_TABLES = [
  // Confirmed on live DB: salon_id column present, NO FK to salons at all.
  "ai_agent_logs", "ai_customer_memory", "ai_token_usage", "appointments",
  "blocked_times", "bookings_archive", "bundles", "client_notes",
  "commission_earned", "commission_settlements", "commission_slabs",
  "ewallet_ledger", "invoices_archive", "memberships", "package_templates",
  "payroll_entries", "payroll_salary_advances", "product_brands",
  "purchases", "referral_ledger", "reward_points_ledger", "sales",
  "subscriptions", "tip_earned", "tip_settlements", "wa_automation_logs",
  "wa_automation_templates", "wa_messages", "wa_review_prompts",
  // These already cascade via FK today (delete_rule=CASCADE, confirmed live);
  // deleting them explicitly too is harmless and guards against that FK ever
  // being dropped/changed later.
  "invoices", "billing_subscriptions",
];

/**
 * Deletes a salon and every row scoped to it. Must be called with a
 * PoolClient already inside an open transaction (BEGIN) — the caller owns
 * commit/rollback so this can be combined with other operations (e.g.
 * deleting the owning user in the same transaction).
 *
 * `bundles` must be cleared before the final salon delete: bundles.category_id
 * -> service_categories is ON DELETE RESTRICT, and service_categories itself
 * cascades from salons, so a leftover bundle row would abort the whole delete.
 *
 * Tables in SALON_ORPHAN_RISK_TABLES are probed with to_regclass first so a
 * table that doesn't exist in a given environment (e.g. not yet migrated)
 * is skipped instead of throwing — the alternative (a hard failure mid-purge
 * on an unrelated missing table) is worse than skipping one that has nothing
 * to delete anyway.
 */
export async function purgeSalon(client: PoolClient, salonId: string): Promise<{ id: string } | null> {
  for (const table of SALON_ORPHAN_RISK_TABLES) {
    const { rows: exists } = await client.query(`SELECT to_regclass($1) AS reg`, [table]);
    if (!exists[0]?.reg) continue;
    await client.query(`DELETE FROM ${table} WHERE salon_id = $1`, [salonId]);
  }

  // Cascades everything else with a direct salon_id FK: staff, clients,
  // services, categories, salon_settings, bookings, packages, products,
  // payments, and more.
  const { rows } = await client.query(
    `DELETE FROM salons WHERE id = $1 RETURNING id`,
    [salonId]
  );
  return rows[0] ?? null;
}

// Phone/address are no longer independently editable on the business record —
// they always mirror the owner's Personal Profile (users.phone/users.address),
// so every read joins to the owner and overrides those two columns.
const SALON_SELECT_WITH_OWNER_CONTACT = `
    SELECT s.id, s.owner_id, s.business_name, s.business_type, s.slug, s.description,
           s.logo_url, s.banner_url, s.email, u.phone AS phone, s.website_url, s.google_review_url,
           s.gst_number, s.pan_number, s.is_verified, s.is_active, s.onboarding_completed,
           u.address AS address, s.city, s.state, s.country, s.pincode, s.timezone,
           s.currency, s.business_category, s.created_at, s.updated_at
    FROM salons s
    LEFT JOIN users u ON s.owner_id = u.id
`;

export const salonsRepository = {
    async findById(id: string): Promise<Salon | null> {
        const { rows } = await pool.query(`${SALON_SELECT_WITH_OWNER_CONTACT} WHERE s.id = $1`, [id]);
        return rows[0] || null;
    },

    async findOwnerEmailById(id: string): Promise<string | null> {
        const { rows } = await pool.query(
            `SELECT COALESCE(s.email, u.email) AS email
             FROM salons s
             LEFT JOIN users u ON s.owner_id = u.id
             WHERE s.id = $1`,
            [id]
        );
        return rows[0]?.email || null;
    },

    async findBySlug(slug: string): Promise<Salon | null> {
        const { rows } = await pool.query(`SELECT * FROM salons WHERE slug = $1`, [slug]);
        return rows[0] || null;
    },

    async findByOwnerId(ownerId: string): Promise<Salon | null> {
        const { rows } = await pool.query(
            `${SALON_SELECT_WITH_OWNER_CONTACT} WHERE s.owner_id = $1 ORDER BY s.created_at DESC LIMIT 1`,
            [ownerId]
        );
        return rows[0] || null;
    },

    async listAll(): Promise<Salon[]> {
        const { rows } = await pool.query(`SELECT * FROM salons ORDER BY created_at DESC`);
        return rows;
    },

    async create(ownerId: string, data: CreateSalonBody): Promise<Salon> {
        const { rows } = await pool.query(
            `INSERT INTO salons (
        owner_id, business_name, business_type, slug, description,
        logo_url, banner_url, email, phone, website_url, gst_number, pan_number
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
            [
                ownerId,
                data.business_name.trim(),
                data.business_type ?? null,
                data.slug ?? null,
                data.description ?? null,
                data.logo_url ?? null,
                data.banner_url ?? null,
                data.email ?? null,
                data.phone ?? null,
                data.website_url ?? null,
                data.gst_number ?? null,
                data.pan_number ?? null,
            ]
        );

        return rows[0];
    },

    async update(id: string, patch: UpdateSalonBody): Promise<Salon> {
        const keys = Object.keys(patch) as (keyof UpdateSalonBody)[];

        // Nothing to update → return current
        if (keys.length === 0) {
            const { rows } = await pool.query(`SELECT * FROM salons WHERE id = $1`, [id]);
            return rows[0];
        }

        const setParts: string[] = [];
        const values: any[] = [];

        keys.forEach((k, idx) => {
            setParts.push(`${k} = $${idx + 1}`);
            values.push((patch as any)[k]);
        });

        // Always update updated_at
        setParts.push(`updated_at = NOW()`);

        values.push(id);

        const { rows } = await pool.query(
            `UPDATE salons
       SET ${setParts.join(", ")}
       WHERE id = $${values.length}
       RETURNING *`,
            values
        );

        return rows[0];
    },
};
