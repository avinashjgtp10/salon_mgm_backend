/**
 * One-time backfill: creates tip_earned rows (status 'paid') for every
 * sale that already has a tip but predates the Tip Settle feature — so
 * the Tip Settle tab's totals reflect real history from day one, instead
 * of every staff member starting at ₹0.
 *
 * Deliberately marks these rows 'paid', not 'pending': the tip was
 * already physically handed to staff at the time (tips have always
 * passed straight through, never held by the salon — see totalsUtils.ts's
 * withCharges) — there is no real pending balance to create for a sale
 * that happened before this feature existed. Only NEW sales, earned via
 * tipCalculationService.earnForSale from now on, start 'pending' and go
 * through an actual Settle action.
 *
 * Attribution, per sale with tip_amount > 0:
 *   1. sales.tip_breakdown, if present (populated by AppointmentModal's
 *      Split by Staff feature, added 2026-08-20) — one row per staff.
 *   2. Else sales.staff_id, if present — full tip_amount credited to that
 *      one staff member (the sale's only assigned staff).
 *   3. Else — skipped. No staff to attribute to; verified against dev on
 *      2026-08-21 that a small number of historical sales (multi-staff or
 *      staff-less Quick Sales) have neither. Guessing an attribution here
 *      would be a real financial-correctness risk, not just a data gap.
 *
 * Idempotent: safe to re-run — skips any sale_id that already has a
 * tip_earned row, so it never double-credits.
 *
 * Run once per environment (dev/QA/prod each need their own run, per this
 * codebase's existing dev/QA/prod drift pattern):
 *   npx ts-node src/seeds/backfill.historical-tips.ts
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

import pool from "../config/database";

async function backfillHistoricalTips() {
  console.log("\n🌱 Backfilling historical tip_earned rows...\n");

  const client = await pool.connect();
  try {
    const { rows: sales } = await client.query(
      `SELECT s.id, s.salon_id, s.staff_id, s.tip_amount, s.tip_breakdown, s.appointment_id, s.created_at
       FROM sales s
       WHERE s.tip_amount > 0
         AND NOT EXISTS (SELECT 1 FROM tip_earned te WHERE te.sale_id = s.id)`
    );

    console.log(`Found ${sales.length} sale(s) with a tip and no existing tip_earned row.`);

    let attributed = 0;
    let skipped = 0;
    let totalBackfilled = 0;

    for (const sale of sales) {
      const tipAmount = parseFloat(sale.tip_amount) || 0;
      if (tipAmount <= 0) continue;

      const breakdown: { staff_id?: string; staffId?: string; amount: number }[] =
        Array.isArray(sale.tip_breakdown) ? sale.tip_breakdown : [];
      const entries = breakdown
        .map((b) => ({ staffId: b.staff_id ?? b.staffId, amount: Number(b.amount) || 0 }))
        .filter((b) => b.staffId && b.amount > 0);

      if (entries.length === 0 && sale.staff_id) {
        entries.push({ staffId: sale.staff_id, amount: tipAmount });
      }

      if (entries.length === 0) {
        skipped++;
        console.log(`  skip  sale ${sale.id} — ₹${tipAmount.toFixed(2)} tip, no staff to attribute to`);
        continue;
      }

      for (const e of entries) {
        await client.query(
          `INSERT INTO tip_earned (salon_id, staff_id, sale_id, appointment_id, tip_amount, status, earned_at, paid_at)
           VALUES ($1,$2,$3,$4,$5,'paid',$6,$6)`,
          [sale.salon_id, e.staffId, sale.id, sale.appointment_id ?? null, e.amount, sale.created_at]
        );
        totalBackfilled += e.amount;
      }
      attributed++;
    }

    console.log(`\n✅ Backfilled ${attributed} sale(s), totalling ₹${totalBackfilled.toFixed(2)} in tip_earned rows.`);
    if (skipped > 0) {
      console.log(`⚠️  Skipped ${skipped} sale(s) with a tip but no attributable staff — see lines above.`);
    }
  } catch (err: any) {
    console.error("❌ Failed:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

backfillHistoricalTips().catch((err) => {
  console.error(err);
  process.exit(1);
});
