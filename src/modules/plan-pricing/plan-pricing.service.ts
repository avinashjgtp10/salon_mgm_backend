import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { createRazorpayPlan, razorpayBilling } from "../../config/razorpay";
import { billingSchemaReady } from "../subscription-pricing/billing-schema";
import { getActiveRazorpayAccount } from "../subscription-pricing/razorpay-account";
import { registerPlanId } from "../subscription-pricing/razorpay-plans";

// The three fixed tiers (same slugs as module_plans, which holds each tier's features) and the billing
// cycles a super admin can price each at.
export const TIERS = [
    { slug: "basic", name: "SalonOx Basic", blurb: "For business looking for essential management features to get started." },
    { slug: "advance", name: "SalonOx Advance", blurb: "For business that need complete salon management functionality." },
    { slug: "growth", name: "SalonOx Growth", blurb: "For growing business that need advanced digital and multi-branch capabilities." },
] as const;
export const CYCLES = ["monthly", "quarterly", "yearly"] as const;
type Tier = (typeof TIERS)[number]["slug"];
type Cycle = (typeof CYCLES)[number];

const MAX_AMOUNT = 10_000_000;

// GST charged on top of every plan price. The price Super Admin enters is BEFORE GST; Razorpay is set up to
// charge price + GST. Whole rupees x 118 is exact in paise, so there is no rounding drift.
export const GST_PERCENT = 18;
export const withGst = (price: number) => Math.round(price * (100 + GST_PERCENT)) / 100;
const planSlug = (tier: Tier, cycle: Cycle) => `salonox-${tier}-${cycle}`;
const isTier = (v: unknown): v is Tier => TIERS.some((t) => t.slug === v);
const cycleLabel: Record<Cycle, string> = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };

interface CyclePrice {
    id: string | null;
    price: number | null;
    is_active: boolean;
    razorpay_plan_id: string | null;
}

export const planPricingService = {
    // One entry per tier with its monthly / quarterly / yearly amount (null = not offered at that cycle).
    async list() {
        const { rows } = await pool.query(
            `SELECT id, slug, price, is_active, razorpay_plan_id FROM subscription_plans WHERE slug LIKE 'salonox-%'`
        );
        const bySlug = new Map(rows.map((r) => [r.slug as string, r]));
        // The Razorpay plan ID shown is the one registered for the account the server is using now. The original column is shown
        // only in LIVE mode (it is the LIVE mapping); TEST never shows or touches it.
        const account = await getActiveRazorpayAccount();
        const registered = new Map<string, string>();
        if (await billingSchemaReady()) {
            const reg = await pool.query(
                `SELECT DISTINCT ON (plan_id) plan_id, razorpay_plan_id FROM razorpay_plan_registry
                 WHERE account_key = $1 AND currency = 'INR' ORDER BY plan_id, created_at DESC`,
                [account.key]
            );
            for (const r of reg.rows) registered.set(r.plan_id as string, r.razorpay_plan_id as string);
        }
        const shownPlanId = (r: { id: string; razorpay_plan_id: string | null }) =>
            registered.get(r.id) ?? (account.mode === "live" ? r.razorpay_plan_id ?? null : null);
        return TIERS.map((t) => {
            const prices = {} as Record<Cycle, CyclePrice>;
            for (const c of CYCLES) {
                const r = bySlug.get(planSlug(t.slug, c));
                prices[c] = r
                    ? { id: r.id, price: r.is_active ? Number(r.price) : null, is_active: Boolean(r.is_active), razorpay_plan_id: shownPlanId(r) }
                    : { id: null, price: null, is_active: false, razorpay_plan_id: null };
            }
            return { slug: t.slug, name: t.name, gst_percent: GST_PERCENT, prices };
        });
    },

    // Public, read-only view for the landing page / registration / billing screens: only the three tiers'
    // active monthly / quarterly / yearly amounts and which modules each includes. Deliberately no ids or Razorpay details, and it ignores unrelated
    // plan rows (e.g. a manual-grant plan).
    async catalog() {
        const [all, mp] = await Promise.all([
            this.list(),
            pool.query(`SELECT slug, configured, locked_modules FROM module_plans`),
        ]);
        const modules = new Map(mp.rows.map((r) => [r.slug as string, r]));
        return all.map((t) => {
            const m = modules.get(t.slug);
            return {
                slug: t.slug,
                name: t.name,
                gst_percent: GST_PERCENT,
                prices: { monthly: t.prices.monthly.price, quarterly: t.prices.quarterly.price, yearly: t.prices.yearly.price },
                // Locked module keys for this tier (null = the tier's modules haven't been set up yet). The
                // screens turn the enabled ones into the plan's feature list.
                locked: m?.configured ? (m.locked_modules as string[]) : null,
            };
        });
    },

    // `prices` maps cycle -> amount in rupees. A number creates/updates and activates that cycle's plan, null
    // switches it off. Razorpay is called FIRST, only for cycles whose amount actually changed (or that have
    // no Razorpay plan yet); if any Razorpay call fails nothing is saved. Plans are never deleted —
    // subscriptions may point at them.
    async set(tier: unknown, prices: unknown) {
        if (!isTier(tier)) throw new AppError(404, "Unknown plan", "NOT_FOUND");
        if (!prices || typeof prices !== "object") {
            throw new AppError(400, "prices must be an object of cycle -> amount", "VALIDATION_ERROR");
        }
        const meta = TIERS.find((t) => t.slug === tier)!;
        const input = prices as Record<string, unknown>;

        const wanted = new Map<Cycle, number | null>();
        for (const c of CYCLES) {
            if (!(c in input)) continue;
            const v = input[c];
            if (v === null || v === undefined || v === "") { wanted.set(c, null); continue; }
            const n = Number(v);
            if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) {
                throw new AppError(400, `${c} amount must be a number greater than 0`, "VALIDATION_ERROR");
            }
            wanted.set(c, Math.round(n * 100) / 100);
        }

        const { rows: existingRows } = await pool.query(
            `SELECT id, slug, price, is_active, razorpay_plan_id, razorpay_amount FROM subscription_plans WHERE slug = ANY($1)`,
            [CYCLES.map((c) => planSlug(tier, c))]
        );
        const existing = new Map(existingRows.map((r) => [r.slug as string, r]));
        const account = await getActiveRazorpayAccount();
        const isLive = account.mode === "live";
        // INR plans this account already has, by plan and amount (price + GST).
        const registeredAmounts = new Set<string>();
        if (await billingSchemaReady() && existingRows.length) {
            const reg = await pool.query(
                `SELECT plan_id, amount FROM razorpay_plan_registry WHERE account_key = $1 AND currency = 'INR' AND plan_id = ANY($2)`,
                [account.key, existingRows.map((r) => r.id)]
            );
            for (const r of reg.rows) registeredAmounts.add(`${r.plan_id}:${Number(r.amount).toFixed(2)}`);
        }

        // 1) Razorpay first.
        const razorpayIds = new Map<Cycle, string>();
        for (const [cycle, amount] of wanted) {
            if (amount === null) continue;
            const row = existing.get(planSlug(tier, cycle));
            // Unchanged only if this account already has a plan charging exactly price + GST (in LIVE, the original column counts too, so
            // existing LIVE plans are not duplicated).
            const unchanged = row && row.is_active && Number(row.price) === amount && (
                registeredAmounts.has(`${row.id}:${withGst(amount).toFixed(2)}`)
                || (isLive && row.razorpay_plan_id && row.razorpay_amount != null && Number(row.razorpay_amount) === withGst(amount))
            );
            if (unchanged) continue;
            razorpayIds.set(cycle, await createRazorpayPlan({
                name: `${meta.name} (${cycleLabel[cycle]})`,
                description: `${meta.blurb} Includes ${GST_PERCENT}% GST.`,
                ...razorpayBilling(cycle),
                amountRupees: withGst(amount),
            }));
        }

        // 2) Then our own table, in one transaction.
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            for (const [cycle, amount] of wanted) {
                const slug = planSlug(tier, cycle);
                if (amount === null) {
                    await client.query(`UPDATE subscription_plans SET is_active = FALSE WHERE slug = $1`, [slug]);
                    continue;
                }
                // The original columns are only ever updated in LIVE; in TEST they keep the LIVE values untouched.
                const rzpId = (isLive ? razorpayIds.get(cycle) : undefined) ?? existing.get(slug)?.razorpay_plan_id ?? null;
                const rzpAmount = isLive && razorpayIds.has(cycle) ? withGst(amount) : existing.get(slug)?.razorpay_amount ?? null;
                const upd = await client.query(
                    `UPDATE subscription_plans
                     SET price = $2, is_active = TRUE, name = $3, tier = $4, razorpay_plan_id = $5, razorpay_amount = $6
                     WHERE slug = $1 RETURNING id`,
                    [slug, amount, meta.name, tier, rzpId, rzpAmount]
                );
                if (upd.rowCount === 0) {
                    await client.query(
                        `INSERT INTO subscription_plans (name, slug, description, price, billing_cycle, is_active, tier, razorpay_plan_id, razorpay_amount)
                         VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8)`,
                        [meta.name, slug, meta.blurb, amount, cycle, tier, rzpId, rzpAmount]
                    );
                }
            }
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
        // Register the plans just created for THIS account (the plan rows exist now, including any that were just inserted).
        for (const [cycle, amount] of wanted) {
            const rzpId = razorpayIds.get(cycle);
            if (amount === null || !rzpId) continue;
            const { rows: planRow } = await pool.query(`SELECT id FROM subscription_plans WHERE slug = $1`, [planSlug(tier, cycle)]);
            if (planRow[0]) await registerPlanId(planRow[0].id, cycle, "INR", withGst(amount), amount, 1, rzpId);
        }
        return (await this.list()).find((p) => p.slug === tier);
    },
};
