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

// ── clearSalonData ───────────────────────────────────────────────────────────
//
// Unlike purgeSalon, this does NOT delete the salons row itself — it wipes
// every transactional/operational table scoped to the salon while keeping
// the account (salons row), its owner login (users), and its config
// (salon_settings, salon_subscriptions, billing_subscriptions) intact, so
// the salon stays active and doesn't need to re-onboard.
//
// Because the salons row survives, ON DELETE CASCADE from salons never
// fires — every table below must be deleted explicitly (there is no "the
// rest cascades for free" shortcut like purgeSalon has). List was built
// from a live information_schema introspection of every table carrying a
// salon_id/tenant_id column and the full FK graph beneath it, run against
// the dev DB on 2026-08-25. Re-verify the same way if a new salon-scoped
// table is added later — this list will not pick it up automatically.
//
// Ordering matters for a handful of RESTRICT/NO ACTION FKs that would
// otherwise abort the transaction:
//   - bundles.category_id -> service_categories is RESTRICT, so bundles
//     must go before service_categories.
//   - wa_review_prompts.review_id -> reviews is NO ACTION, so it must go
//     before reviews.
//   - purchases.supplier_id -> suppliers and
//     stock_movements.stocktake_id -> stocktakes are NO ACTION, so
//     purchases/purchase_items/stock_movements must go before
//     suppliers/stocktakes.
// Every other table here either has no incoming RESTRICT/NO ACTION FK from
// another table on this same list, or its children cascade from it
// (e.g. sale_items cascades from sales, client_addresses from clients).
const SALON_CLEAR_DATA_TABLES = [
  // Deepest first: rows only ever reached via a RESTRICT/NO ACTION FK from
  // another table on this list.
  "purchase_items", "purchases", "stock_movements", "wa_review_prompts",
  "bundle_services", "bundles",

  // Clients & their sub-records (cascade from clients, listed for clarity —
  // harmless to delete explicitly even though clients cascade would too).
  "client_addresses", "client_emergency_contacts", "client_preferences",
  "client_notes", "clients",

  // Appointments / bookings
  "appointment_service_consumables", "appointments", "blocked_times",
  "booking_services", "bookings", "bookings_archive",

  // Sales / Quick Sale / invoices / payments
  "sale_items", "sales", "invoices", "invoices_archive", "payments",

  // Services & products sold (catalog)
  "service_add_on_options", "service_add_on_groups", "service_consultation_forms",
  "service_consumables", "service_staff", "services", "service_categories",
  "product_photos", "product_unit_conversions", "products", "product_brands",
  "taxes",

  // Packages & memberships
  "client_package_service_schedules", "client_package_session_history",
  "client_package_services", "client_packages", "package_offers",
  "package_services", "packages", "package_template_services",
  "package_templates", "membership_services", "membership_usage_log",
  "client_memberships", "memberships",

  // Staff-related transactional data
  "staff_addresses", "staff_emergency_contacts", "staff_commission_settings",
  "staff_wage_settings", "staff_pay_run_settings", "staff_leaves",
  "staff_schedules", "staff_services", "staff_biometric_mappings",
  "staff_branches", "staff_invitations",

  // Attendance
  "attendance", "attendance_settings",

  // Payroll & commissions
  "payroll_entries", "payroll_salary_advances",
  "commission_earned", "commission_settlements",
  "commission_rule_tiers", "commission_rules", "commission_slabs",
  "tip_earned", "tip_settlements",

  // Staff themselves — deleted only after every staff_id-referencing table
  // above, since most of those cascade FROM staff (deleting staff first
  // would be fine too, but this keeps the ordering self-evidently safe).
  // Does NOT touch users: staff.user_id -> users is CASCADE in the other
  // direction (deleting a staff row never deletes its linked login).
  "staff",

  // `subscriptions` (Razorpay-hosted flow) deliberately NOT cleared — despite
  // the name, it's the CURRENT active-plan table subscription.middleware.ts
  // checks first (billing_subscriptions is only its legacy/manual fallback).
  // A prior version of this list deleted it, which silently revoked the
  // salon's active subscription — locking the account out with
  // SUBSCRIPTION_REQUIRED until a new one was created. Preserved here the
  // same way salon_subscriptions/billing_subscriptions already are.

  // Cash management
  "cash_management_expenses", "cash_management",

  // Inventory / stock
  "branch_stock", "branch_stock_transfers", "stock_reconciliation",
  "stock_transfers", "consumable_usage", "stocktakes", "suppliers",

  // Enquiries
  "enquiries",

  // Marketing
  "campaign_recipients", "campaigns", "coupon_designs", "coupons",
  "wa_campaign_contacts", "wa_campaigns", "wa_messages", "wa_conversations",
  "wa_templates", "wa_automation_logs", "wa_automation_templates",
  "wa_automation_sent_guard", "wa_salon_automation_settings",
  "whatsapp_configs", "whatsapp_credits",
  "loyalty_settings", "reward_points_ledger", "referral_ledger", "ewallet_ledger",

  // Reviews
  "review_service_ratings", "reviews",

  // Marketplace listings tied to this salon (operational, not onboarding)
  "marketplace_bookings", "marketplace_booking_settings", "marketplace_features",
  "marketplace_images", "marketplace_locations", "marketplace_working_hours",
  "marketplace_listings", "marketplace_profiles",

  // Branches (operational locations, not onboarding config)
  "branch_holidays", "branch_timings", "branch_owner_salons", "branches",

  // AI / notifications / devices / support / misc operational data
  "ai_agent_logs", "ai_chat_sessions", "ai_customer_memory", "ai_predictions",
  "ai_recommendations", "ai_token_usage",
  "business_health_scores",
  "device_tokens", "devices", "push_notification_receipts", "notifications",
  "support_tickets",
  "salon_brand_kits", "salon_invoice_counters", "salon_group_members",
  "bot_questions", "subscription_permission_audit_log",
];

/**
 * Clears every transactional/operational table for a salon while keeping
 * the salon account, its owner's login, and its config/onboarding state
 * intact. Must be called with a PoolClient already inside an open
 * transaction — the caller owns commit/rollback.
 */
export async function clearSalonData(client: PoolClient, salonId: string): Promise<boolean> {
  const { rows: salons } = await client.query(`SELECT id FROM salons WHERE id = $1`, [salonId]);
  if (!salons[0]) return false;

  // One bulk lookup instead of two information_schema round-trips per table
  // (was ~280 sequential queries against a remote DB, slow enough to blow
  // past the frontend's request timeout).
  const { rows: colRows } = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ANY($1)
       AND column_name IN ('salon_id', 'source_salon_id', 'dest_salon_id')`,
    [SALON_CLEAR_DATA_TABLES]
  );
  const colsByTable = new Map<string, string[]>();
  for (const { table_name, column_name } of colRows as { table_name: string; column_name: string }[]) {
    if (!colsByTable.has(table_name)) colsByTable.set(table_name, []);
    colsByTable.get(table_name)!.push(column_name);
  }

  for (const table of SALON_CLEAR_DATA_TABLES) {
    const colNames = colsByTable.get(table);
    if (!colNames || colNames.length === 0) continue;

    const whereClause = colNames.map((c: string) => `${c} = $1`).join(" OR ");
    await client.query(`DELETE FROM ${table} WHERE ${whereClause}`, [salonId]);
  }

  // The invoice/enquiry/purchase numbers above (sales.repository.ts,
  // enquiries.repository.ts, purchases.repository.ts) aren't derived from
  // the deleted rows — each is a running counter column on the salons row
  // itself (next_invoice_seq/next_enquiry_seq/next_purchase_seq), so wiping
  // the rows above left new records continuing from the old high number
  // instead of restarting at 1, same DEFAULT every salon starts at.
  await client.query(
    `UPDATE salons
     SET next_invoice_seq = 1, next_enquiry_seq = 1, next_purchase_seq = 1
     WHERE id = $1`,
    [salonId]
  );

  return true;
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
