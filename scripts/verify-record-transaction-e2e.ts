/**
 * End-to-end verification of recordTransaction() against real dev data, for
 * all 4 origins. Creates real sales/sale_items rows (tagged with a distinctive
 * note so they can be cleaned up), verifies the constraint/tax/item_type fixes
 * actually work against the live DB (not just type-check), then deletes what
 * it created.
 * Run with: npx ts-node scripts/verify-record-transaction-e2e.ts
 */
import pool from "../src/config/database";
import { recordTransaction } from "../src/modules/transactions/transaction-recorder.service";

const TAG = "E2E-VERIFY-" + Date.now();
const SALON_ID = "7d52e62a-5e5a-43a9-95ed-62e29b86b8e2";
const CLIENT_ID = "11c63089-23d1-421e-8d56-d6b3605f6b17";
const STAFF_ID = "3efd8289-78e1-405a-98b7-9be024dc22c7";

const createdSaleIds: string[] = [];
let failures = 0;

function check(label: string, cond: boolean, detail: string) {
  if (cond) {
    console.log(`OK: ${label}`);
  } else {
    console.error(`FAIL: ${label} — ${detail}`);
    failures++;
  }
}

async function run() {
  // ── 1. calendar_checkout: service + tax, plain "Cash" ────────────────────
  try {
    const r = await recordTransaction({
      salon_id: SALON_ID, client_id: CLIENT_ID, staff_id: STAFF_ID,
      origin: "calendar_checkout",
      payment_label: "Cash",
      tax_amount: 25,
      notes: TAG,
      items: [{ item_type: "service", name: "Test Haircut", quantity: 1, unit_price: 500 }],
    });
    createdSaleIds.push(r.sale.id);
    check("calendar_checkout: payment_method normalized", r.sale.payment_method === "cash", `got ${r.sale.payment_method}`);
    check("calendar_checkout: tax included in total", Number(r.sale.total_amount) === 525, `got ${r.sale.total_amount}`);
    check("calendar_checkout: item_type", r.items[0]?.item_type === "service", `got ${r.items[0]?.item_type}`);
  } catch (err: any) {
    console.error("FAIL: calendar_checkout threw:", err.message);
    failures++;
  }

  // ── 2. quick_sell: split payment (Cash+Card) ──────────────────────────────
  try {
    const r = await recordTransaction({
      salon_id: SALON_ID, client_id: CLIENT_ID, staff_id: STAFF_ID,
      origin: "quick_sell",
      payment_label: "Cash+Card",
      split_details: { Cash: 200, Card: 300 },
      notes: TAG,
      items: [{ item_type: "product", name: "Test Shampoo", quantity: 1, unit_price: 500 }],
    });
    createdSaleIds.push(r.sale.id);
    check("quick_sell: split normalized correctly", r.sale.payment_method === "split", `got ${r.sale.payment_method}`);
    check("quick_sell: payment_reference stores breakdown", !!r.sale.payment_reference && r.sale.payment_reference.includes("200"), `got ${r.sale.payment_reference}`);
  } catch (err: any) {
    console.error("FAIL: quick_sell threw:", err.message);
    failures++;
  }

  // ── 3. package_purchase: item_type "package", plain "Card" ────────────────
  try {
    const r = await recordTransaction({
      salon_id: SALON_ID, client_id: CLIENT_ID,
      origin: "package_purchase",
      payment_label: "Card",
      notes: TAG,
      items: [{ item_type: "package", name: "Test Package", quantity: 1, unit_price: 3000 }],
    });
    createdSaleIds.push(r.sale.id);
    check("package_purchase: payment_method normalized", r.sale.payment_method === "card", `got ${r.sale.payment_method}`);
    check("package_purchase: item_type is 'package' not 'service'", r.items[0]?.item_type === "package", `got ${r.items[0]?.item_type}`);
  } catch (err: any) {
    console.error("FAIL: package_purchase threw:", err.message);
    failures++;
  }

  // ── 4. membership_purchase: eWallet-only payment ──────────────────────────
  try {
    const r = await recordTransaction({
      salon_id: SALON_ID, client_id: CLIENT_ID,
      origin: "membership_purchase",
      payment_label: "eWallet",
      notes: TAG,
      items: [{ item_type: "membership", name: "Test Membership", quantity: 1, unit_price: 2000 }],
    });
    createdSaleIds.push(r.sale.id);
    check("membership_purchase: eWallet normalized to 'wallet'", r.sale.payment_method === "wallet", `got ${r.sale.payment_method}`);
    check("membership_purchase: item_type", r.items[0]?.item_type === "membership", `got ${r.items[0]?.item_type}`);
  } catch (err: any) {
    console.error("FAIL: membership_purchase threw:", err.message);
    failures++;
  }

  // ── 5. Idempotency: same appointment_id twice should reuse, not duplicate ─
  try {
    const apptId = "00000000-0000-0000-0000-000000000001"; // fake, just for idempotency check on sales table
    const first = await recordTransaction({
      salon_id: SALON_ID, client_id: CLIENT_ID, appointment_id: apptId,
      origin: "calendar_checkout", payment_label: "UPI", notes: TAG,
      items: [{ item_type: "service", name: "Idempotency Test", quantity: 1, unit_price: 100 }],
    });
    createdSaleIds.push(first.sale.id);
    const second = await recordTransaction({
      salon_id: SALON_ID, client_id: CLIENT_ID, appointment_id: apptId,
      origin: "calendar_checkout", payment_label: "UPI", notes: TAG,
      items: [{ item_type: "service", name: "Idempotency Test", quantity: 1, unit_price: 100 }],
    });
    check("idempotency: second call reuses existing sale", second.wasIdempotentReuse === true && second.sale.id === first.sale.id, `first=${first.sale.id} second=${second.sale.id} reuse=${second.wasIdempotentReuse}`);
  } catch (err: any) {
    console.error("FAIL: idempotency check threw:", err.message);
    failures++;
  }

  // ── 6. Unrecognized payment method should throw, not silently insert ─────
  try {
    await recordTransaction({
      salon_id: SALON_ID, client_id: CLIENT_ID,
      origin: "quick_sell", payment_label: "Bitcoin", notes: TAG,
      items: [{ item_type: "product", name: "Should not be created", quantity: 1, unit_price: 100 }],
    });
    console.error("FAIL: unrecognized payment method did NOT throw");
    failures++;
  } catch (err: any) {
    check("unrecognized payment method throws", err.message.includes("UNRECOGNIZED_PAYMENT_METHOD"), `got: ${err.message}`);
  }

  // ── Cleanup ────────────────────────────────────────────────────────────
  console.log(`\nCleaning up ${createdSaleIds.length} test sales...`);
  for (const id of createdSaleIds) {
    await pool.query(`DELETE FROM sale_items WHERE sale_id = $1`, [id]);
    await pool.query(`DELETE FROM sales WHERE id = $1`, [id]);
  }
  console.log("Cleanup done.");

  console.log(failures === 0 ? "\n✅ All checks passed" : `\n❌ ${failures} check(s) failed`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(async (err) => {
  console.error("Script crashed:", err);
  // Best-effort cleanup even on crash
  for (const id of createdSaleIds) {
    try {
      await pool.query(`DELETE FROM sale_items WHERE sale_id = $1`, [id]);
      await pool.query(`DELETE FROM sales WHERE id = $1`, [id]);
    } catch {}
  }
  process.exit(1);
});
