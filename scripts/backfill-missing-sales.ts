/**
 * Backfills sales/sale_items for paid/partial appointments that never got one
 * (the ~302 found during investigation — mostly caused by the 4 divergent
 * sale-creation code paths this consolidation replaced with recordTransaction()).
 *
 * Do NOT run this until:
 *   1. The schema migrations (db-migrations/1784114108119-122) have been run.
 *   2. Phase 5's write-path fix has been live for a few days, confirmed via
 *      the same query below that new paid appointments have stopped
 *      appearing without a sales row (per the plan's rollout order).
 *
 * Reuses recordTransaction() itself — not a second hand-rolled copy of the
 * item-building logic, which is exactly what caused this bug in the first place.
 *
 * Run with:  npx ts-node scripts/backfill-missing-sales.ts --dry-run
 * Then:      npx ts-node scripts/backfill-missing-sales.ts
 */
import pool from "../src/config/database";
import { appointmentsRepository } from "../src/modules/appointments/appointments.repository";
import { paymentsRepository } from "../src/modules/payments/payments.repository";
import { recordTransaction } from "../src/modules/transactions/transaction-recorder.service";

const DRY_RUN = process.argv.includes("--dry-run");

async function findBrokenAppointmentIds(): Promise<string[]> {
  const { rows } = await pool.query(`
    SELECT a.id
    FROM appointments a
    JOIN payments p ON p.appointment_id = a.id
    WHERE a.status IN ('paid', 'partial')
      AND a.sale_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.appointment_id = a.id)
    GROUP BY a.id
    ORDER BY a.updated_at ASC
  `);
  return rows.map((r) => r.id);
}

function buildItems(appt: any) {
  const items: Array<{ item_type: any; item_id?: string; staff_id?: string; name: string; quantity: number; unit_price: number }> = [
    ...(appt.services || []).map((s: any) => ({
      item_type: "service" as const,
      item_id: s.service_id,
      staff_id: s.staff_id || undefined,
      name: s.name || "Service",
      quantity: Number(s.quantity) || 1,
      unit_price: Number(s.price) || 0,
    })),
    ...(appt.package_items || []).map((p: any) => ({
      item_type: "package" as const,
      item_id: p.package_id,
      staff_id: p.staff_id || undefined,
      name: p.name || "Package",
      quantity: Number(p.quantity) || 1,
      unit_price: Number(p.price) || 0,
    })),
    ...(appt.product_items || []).map((p: any) => ({
      item_type: "product" as const,
      item_id: p.product_id || undefined,
      staff_id: p.staff_id || undefined,
      name: p.name || "Product",
      quantity: Number(p.quantity) || 1,
      unit_price: Number(p.price) || 0,
    })),
    ...(appt.membership_items || []).map((m: any) => ({
      item_type: "membership" as const,
      item_id: m.membership_id || undefined,
      staff_id: m.staff_id || undefined,
      name: m.name || "Membership",
      quantity: Number(m.quantity) || 1,
      unit_price: Number(m.price) || 0,
    })),
  ];
  if (items.length === 0) {
    items.push({
      item_type: "service" as const,
      name: appt.title || "Appointment Service",
      quantity: 1,
      unit_price: 0,
    });
  }
  return items;
}

async function run() {
  const ids = await findBrokenAppointmentIds();
  console.log(`Found ${ids.length} paid/partial appointments with no sales row.`);
  if (DRY_RUN) console.log("--- DRY RUN: no writes will be made ---");

  const results = { succeeded: 0, skipped: [] as Array<{ id: string; reason: string }>, failed: [] as Array<{ id: string; error: string }> };

  // Sequential, not parallel — invoice_number generation collides under
  // concurrent inserts if run in a tight loop (see sales.repository.ts fix).
  for (const id of ids) {
    const appt = await appointmentsRepository.findById(id);
    if (!appt) {
      results.skipped.push({ id, reason: "appointment_not_found" });
      continue;
    }

    const payment = await paymentsRepository.findByAppointmentId(id);
    if (!payment) {
      results.skipped.push({ id, reason: "no_payment_record" });
      continue;
    }
    if (!payment.payment_method) {
      results.skipped.push({ id, reason: "payment_has_no_method" });
      continue;
    }

    const items = buildItems(appt);

    if (DRY_RUN) {
      console.log(`Would backfill ${id}: payment_method="${payment.payment_method}" items=${items.length} paid_amount=${payment.paid_amount}`);
      results.succeeded++;
      continue;
    }

    try {
      const { sale } = await recordTransaction({
        salon_id: appt.salon_id,
        client_id: appt.client_id ?? undefined,
        appointment_id: id,
        staff_id: appt.staff_id ?? undefined,
        origin: "calendar_checkout",
        payment_label: payment.payment_method,
        split_details: payment.split_details ?? undefined,
        discount_amount: Number(payment.discount_amount) || undefined,
        // payments has no raw tax_amount column — only a per-line tax_breakdown
        // snapshot (CGST/SGST/etc.) taken at payment time; sum it for the total.
        tax_amount: (payment.tax_breakdown ?? []).reduce((sum, t) => sum + (Number(t.amount) || 0), 0) || undefined,
        // ex_charges counts as revenue, tip_amount doesn't — both were on the
        // appointment all along but never reached the sale record.
        ex_charges: Number(appt.ex_charges) || undefined,
        tip_amount: Number(appt.tip_amount) || undefined,
        notes: "Backfilled — appointment was paid but never got a sales row (pre-consolidation bug)",
        created_at: appt.created_at,
        items,
      });
      await appointmentsRepository.linkSale(id, sale.id);
      results.succeeded++;
      console.log(`Backfilled ${id} -> sale ${sale.id}`);
    } catch (err: any) {
      results.failed.push({ id, error: err?.message ?? String(err) });
      console.error(`FAILED ${id}: ${err?.message ?? err}`);
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Succeeded: ${results.succeeded}`);
  console.log(`Skipped:   ${results.skipped.length}`);
  results.skipped.forEach((s) => console.log(`  - ${s.id}: ${s.reason}`));
  console.log(`Failed:    ${results.failed.length}`);
  results.failed.forEach((f) => console.log(`  - ${f.id}: ${f.error}`));

  await pool.end();
}

run().catch((err) => {
  console.error("Backfill script crashed:", err);
  process.exit(1);
});
