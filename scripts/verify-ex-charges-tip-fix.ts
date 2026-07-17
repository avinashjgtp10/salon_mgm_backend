/**
 * Verifies: ex_charges counts toward sales.total_amount (revenue), tip_amount
 * does not (passes through to staff). Creates one test sale, checks the math,
 * cleans up.
 * Run with: npx ts-node scripts/verify-ex-charges-tip-fix.ts
 */
import pool from "../src/config/database";
import { recordTransaction } from "../src/modules/transactions/transaction-recorder.service";

const SALON_ID = "7d52e62a-5e5a-43a9-95ed-62e29b86b8e2";

async function run() {
  const r = await recordTransaction({
    salon_id: SALON_ID,
    origin: "calendar_checkout",
    payment_label: "Cash",
    ex_charges: 500,
    tip_amount: 1000,
    notes: "VERIFY-EX-CHARGES-TIP — safe to delete",
    items: [{ item_type: "service", name: "Test Service", quantity: 1, unit_price: 1000 }],
  });

  const expectedTotal = 1000 /* item */ + 500 /* ex_charges, counts as revenue */; // tip excluded
  const actualTotal = Number(r.sale.total_amount);
  const actualExCharges = Number((r.sale as any).ex_charges);
  const actualTip = Number(r.sale.tip_amount);

  console.log(`total_amount: ${actualTotal} (expected ${expectedTotal}, tip's ₹1000 correctly excluded) -> ${actualTotal === expectedTotal ? "OK" : "FAIL"}`);
  console.log(`ex_charges stored: ${actualExCharges} -> ${actualExCharges === 500 ? "OK" : "FAIL"}`);
  console.log(`tip_amount stored (separately, not in total): ${actualTip} -> ${actualTip === 1000 ? "OK" : "FAIL"}`);

  await pool.query(`DELETE FROM sale_items WHERE sale_id = $1`, [r.sale.id]);
  await pool.query(`DELETE FROM sales WHERE id = $1`, [r.sale.id]);
  console.log("Cleaned up test sale.");
  await pool.end();
}

run().catch(async (err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
