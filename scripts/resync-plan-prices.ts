/**
 * Compares each tier's admin-set price (salon_plan_definitions.price) with the
 * amount Razorpay will actually charge (the linked subscription_plans row and
 * the Razorpay plan itself). Read-only by default.
 *
 *   npx ts-node scripts/resync-plan-prices.ts          # report only
 *   npx ts-node scripts/resync-plan-prices.ts --apply  # re-sync mismatched tiers
 */
import "dotenv/config";
import Razorpay from "razorpay";
import pool from "../src/config/database";
import { salonPlansService } from "../src/modules/salon-plans/salon-plans.service";

const apply = process.argv.includes("--apply");

async function main() {
    const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID!,
        key_secret: process.env.RAZORPAY_KEY_SECRET!,
    });
    console.log(`Razorpay key: ${process.env.RAZORPAY_KEY_ID?.slice(0, 9)}…  mode: ${apply ? "APPLY" : "dry-run"}\n`);

    // updated_by is a UUID column — attribute to the most recent editor of any tier.
    const { rows: who } = await pool.query(
        `SELECT updated_by FROM salon_plan_definitions WHERE updated_by IS NOT NULL ORDER BY updated_at DESC LIMIT 1`
    );
    const actor: string | undefined = who[0]?.updated_by;
    if (apply && !actor) throw new Error("No existing updated_by user to attribute the sync to");

    const { rows } = await pool.query(
        `SELECT d.tier, d.price AS admin_price, d.linked_subscription_plan_id,
                sp.price AS linked_db_price, sp.razorpay_plan_id, sp.is_active
         FROM salon_plan_definitions d
         LEFT JOIN subscription_plans sp ON sp.id = d.linked_subscription_plan_id
         ORDER BY d.price`
    );

    for (const r of rows) {
        const adminPaise = Math.round(Number(r.admin_price) * 100);
        let rzpPaise: number | null = null;
        if (r.razorpay_plan_id) {
            try {
                const rzp: any = await razorpay.plans.fetch(r.razorpay_plan_id);
                rzpPaise = rzp?.item?.amount ?? null;
            } catch (e: any) {
                console.log(`  (could not fetch Razorpay plan ${r.razorpay_plan_id}: ${e?.error?.description ?? e?.message})`);
            }
        }
        const ok = r.linked_subscription_plan_id && r.is_active !== false && rzpPaise === adminPaise;
        console.log(
            `${r.tier.padEnd(8)} admin ₹${r.admin_price} | linked DB ₹${r.linked_db_price ?? "—"} | ` +
            `Razorpay ₹${rzpPaise === null ? "—" : rzpPaise / 100} | ${ok ? "OK" : "MISMATCH"}`
        );
        if (!ok && apply) {
            await salonPlansService.syncToRazorpay(r.tier, actor!);
            console.log(`  → re-synced ${r.tier}`);
        }
    }
    await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
