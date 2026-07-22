import { salesRepository } from "../sales/sales.repository";
import logger from "../../config/logger";
import { normalizePaymentMethod } from "./payment-method.util";
import {
  RecordTransactionInput,
  RecordTransactionResult,
  SaleRecordFailedError,
} from "./transaction.types";

/**
 * The single write path for "a sale happened" — replaces the 4 independent
 * copies that used to live in payments.service.ts, appointments.service.ts
 * (checkout fallback), client-packages.service.ts, and
 * client-memberships.service.ts. Every one of those had its own subtly
 * different payment_method normalization (or none at all), which is why
 * ~300 real paid appointments never got a sales row: the raw frontend label
 * ("Cash+Card", "eWallet", ...) hit sales_payment_method_check directly and
 * failed, silently, inside a try/catch.
 */
export async function recordTransaction(input: RecordTransactionInput): Promise<RecordTransactionResult> {
  // Idempotency: never create a SECOND sale row for the same appointment —
  // but an existing one is refreshed to the current bill rather than left
  // frozen at whatever it was when first created. Without this, editing a
  // paid appointment and collecting the difference left Sales Summary,
  // Client History's Sales list, and invoice reprint all showing the stale
  // original total/items forever, even though the appointment itself was
  // correctly updated.
  if (input.appointment_id) {
    const existing = await salesRepository.findByAppointmentId(input.appointment_id);
    if (existing) {
      const updated = await salesRepository.update(existing.id, {
        discount_amount: input.discount_amount != null ? String(input.discount_amount) : undefined,
        tax_amount:      input.tax_amount      != null ? String(input.tax_amount)      : undefined,
        tip_amount:      input.tip_amount      != null ? String(input.tip_amount)      : undefined,
        ex_charges:      input.ex_charges      != null ? String(input.ex_charges)      : undefined,
        items: input.items.map((item) => ({
          item_type: item.item_type,
          item_id: item.item_id,
          staff_id: item.staff_id,
          name: item.name,
          quantity: item.quantity,
          unit_price: String(item.unit_price),
          discount_amount: item.discount_amount != null ? String(item.discount_amount) : undefined,
        })),
      });
      const items = await salesRepository.findItemsBySaleId(updated.id);
      const enriched = await salesRepository.findById(updated.id);
      return { sale: enriched ?? updated, items, wasIdempotentReuse: true };
    }
  }

  const { method, reference } = normalizePaymentMethod(input.payment_label, input.split_details);

  try {
    const sale = await salesRepository.create(
      {
        salon_id: input.salon_id,
        client_id: input.client_id,
        appointment_id: input.appointment_id,
        staff_id: input.staff_id,
        status: "completed",
        discount_amount: input.discount_amount != null ? String(input.discount_amount) : undefined,
        tax_amount: input.tax_amount != null ? String(input.tax_amount) : undefined,
        tip_amount: input.tip_amount != null ? String(input.tip_amount) : undefined,
        ex_charges: input.ex_charges != null ? String(input.ex_charges) : undefined,
        payment_method: method,
        payment_reference: reference,
        notes: input.notes,
        created_at: input.created_at,
        coupon_code: input.coupon_code,
        discount_percent: input.discount_percent != null ? String(input.discount_percent) : undefined,
        discount_type: input.discount_type,
        items: input.items.map((item) => ({
          item_type: item.item_type,
          item_id: item.item_id,
          staff_id: item.staff_id,
          name: item.name,
          quantity: item.quantity,
          unit_price: String(item.unit_price),
          discount_amount: item.discount_amount != null ? String(item.discount_amount) : undefined,
        })),
      },
      input.created_by ?? null
    );

    const items = await salesRepository.findItemsBySaleId(sale.id);
    const enriched = await salesRepository.findById(sale.id);
    return { sale: enriched ?? sale, items, wasIdempotentReuse: false };
  } catch (err) {
    logger.error("[SALE_RECORD_FAILED] recordTransaction insert failed", {
      origin: input.origin,
      appointment_id: input.appointment_id,
      salon_id: input.salon_id,
      payment_label: input.payment_label,
      error: err,
    });
    throw new SaleRecordFailedError(input.origin, err);
  }
}
