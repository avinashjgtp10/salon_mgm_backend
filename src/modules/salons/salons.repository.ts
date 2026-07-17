import type { PoolClient } from "pg";
import pool from "../../config/database";
import { CreateSalonBody, UpdateSalonBody, Salon } from "./salons.types";

// Tables with a salon_id column but NO foreign key constraint to salons — ON
// DELETE CASCADE never fires for these, so rows would be silently orphaned
// (left behind, pointing at a salon that no longer exists) unless deleted
// explicitly. Verified directly against the live schema
// (information_schema.table_constraints / referential_constraints) — do not
// trust this list going stale silently; re-check the schema if a new
// salon-scoped table is added and this list isn't updated for it.
const SALON_ORPHAN_RISK_TABLES = [
  "ai_agent_logs", "ai_customer_memory", "ai_token_usage", "appointments",
  "blocked_times", "bookings_archive", "bundles", "invoices_archive",
  "memberships", "package_templates", "product_brands", "sales", "subscriptions",
  "wa_automation_logs", "wa_automation_templates",
  // These two already cascade via FK today; deleting them explicitly too is
  // harmless and guards against that FK ever being dropped/changed later.
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
 */
export async function purgeSalon(client: PoolClient, salonId: string): Promise<{ id: string } | null> {
  for (const table of SALON_ORPHAN_RISK_TABLES) {
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

export const salonsRepository = {
    async findById(id: string): Promise<Salon | null> {
        const { rows } = await pool.query(`SELECT * FROM salons WHERE id = $1`, [id]);
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
            `SELECT * FROM salons WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 1`,
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
