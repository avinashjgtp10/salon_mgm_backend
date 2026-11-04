/**
 * One-time data fix: owners who PAID (an active subscription) before their salon existed, and so have a subscription tied to their
 * user but no salon. For each one it creates the salon from their registration details (the same ensureForOwner the Razorpay
 * webhook uses), moves their subscriptions onto it, and bills any payment that has no invoice yet (which emails the invoice PDF).
 *
 * Per project policy this is NOT run automatically — invoke it manually against each environment (dev, then QA, then prod).
 *
 * Idempotent: an owner who already has a salon is reused (never a second one), a payment that already has an invoice is not billed
 * again, and once an owner is fixed they no longer match the query below. Re-running is safe.
 *
 * Usage (from salon_mgm_backend/):
 *   npx ts-node scripts/backfill-paid-owner-salons.ts            # dry run: lists who would be fixed, changes nothing
 *   npx ts-node scripts/backfill-paid-owner-salons.ts --apply    # does it
 */
import pool from "../src/config/database";
import { salonsService } from "../src/modules/salons/salons.service";
import { subscriptionCheckoutService } from "../src/modules/subscriptions/subscription-checkout.service";

async function main() {
    const apply = process.argv.includes("--apply");

    const { rows } = await pool.query(
        `SELECT DISTINCT s.user_id, u.email
         FROM subscriptions s
         JOIN users u ON u.id = s.user_id
         WHERE s.salon_id IS NULL AND s.user_id IS NOT NULL AND s.status = 'active'
         ORDER BY u.email`
    );

    console.log(`${rows.length} paid owner(s) without a salon${apply ? "" : " (dry run - pass --apply to fix them)"}`);
    let fixed = 0;
    for (const r of rows) {
        if (!apply) { console.log(`  would fix: ${r.email} (${r.user_id})`); continue; }
        try {
            const salon = await salonsService.ensureForOwner(r.user_id);
            if (!salon) { console.warn(`  skipped ${r.email}: user not found`); continue; }
            const moved = await subscriptionCheckoutService.attachPendingToSalon(r.user_id, salon.id);
            console.log(`  fixed ${r.email}: salon ${salon.id}, ${moved} subscription(s) attached`);
            fixed++;
        } catch (err: any) {
            console.error(`  FAILED ${r.email}: ${err?.message}`);
        }
    }
    if (apply) console.log(`Done: ${fixed} of ${rows.length} fixed.`);
}

main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end().then(() => process.exit()));
