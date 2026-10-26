import { AppError } from '../../middleware/error.middleware';
import { appointmentsRepository } from '../appointments/appointments.repository';
import { computeAppointmentTotals } from '../appointments/appointment-totals';
import { paymentsRepository } from '../payments/payments.repository';
import { getActiveTaxes } from '../settings/tax.util';
import { POS_PAYMENT_MODES, PosPaymentMode } from './pos-payments.types';

const AMOUNT_TOLERANCE = 0.5; // rupees — same rounding allowance as finalizeSuccess

export type AppointmentOutstanding = {
  billTotal: number;
  alreadyPaid: number;
  outstanding: number;
  appointmentStatus: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The appointment's outstanding balance from its stored inputs, using the
 * same rule appointments.service update() uses to decide paid vs partial:
 * the bill recomputed by computeAppointmentTotals, minus everything already
 * collected (payments.repository getTotalPaidForAppointment). An appointment
 * already marked 'paid' owes nothing.
 *
 * The bill excludes discounts that only exist on a payment being made
 * (coupon, referral first-bill discount, a new membership discount), so
 * this is an upper bound — safe for rejecting overcharges, never for
 * computing what to charge.
 */
export async function getAppointmentOutstanding(appointmentId: string, salonId: string): Promise<AppointmentOutstanding> {
  const appt = await appointmentsRepository.findById(appointmentId);
  if (!appt || String((appt as any).salon_id) !== String(salonId)) {
    throw new AppError(404, 'Appointment not found', 'NOT_FOUND');
  }
  let taxes: Awaited<ReturnType<typeof getActiveTaxes>> = [];
  if ((appt as any).include_gst !== false) {
    try {
      taxes = await getActiveTaxes(salonId);
    } catch {
      // Fail closed: without the tax config the bill can't be verified.
      throw new AppError(503, 'Could not verify the outstanding balance — try again', 'BALANCE_UNAVAILABLE');
    }
  }
  const billTotal = round2(computeAppointmentTotals(appt as any, taxes).grandTotal);
  const alreadyPaid = round2(await paymentsRepository.getTotalPaidForAppointment(appointmentId));
  const outstanding = appt.status === 'paid' ? 0 : Math.max(0, round2(billTotal - alreadyPaid));
  return { billTotal, alreadyPaid, outstanding, appointmentStatus: appt.status };
}

// The method labels a machine payment's payload may carry, and what each asks
// the machine to accept. "Payment Machine" is the manual provider's own
// method (and the Paytm method before Card/UPI routing) — no specific mode.
const MACHINE_METHOD_MODES: Record<string, PosPaymentMode | null> = {
  Card: 'CARD',
  UPI: 'QR',
  'Payment Machine': null,
};
const PAYLOAD_TOLERANCE = 0.01; // both sides come from the same frontend numbers

type MachinePayload = {
  payment_method?: string | null;
  paid_amount?: number | string | null;
  ewallet_used?: number | string | null;
  split_details?: Record<string, number> | null;
} | null | undefined;

/**
 * Which mode the machine should be asked for, from the payload's own method:
 * Card → CARD, UPI → QR, "Payment Machine" → none. Rejects (400) a method the
 * machine can't collect (Cash, Split…) and a `requestedMode` that contradicts
 * the method — the machine must charge exactly what the bill will record.
 */
export function resolvePosPaymentMode(payload: MachinePayload, requestedMode?: string | null): PosPaymentMode | null {
  const method = String(payload?.payment_method ?? '');
  if (!(method in MACHINE_METHOD_MODES)) {
    throw new AppError(400, `"${method || 'no method'}" can't be collected on the payment machine — only Card or UPI`, 'INVALID_PAYMENT_METHOD');
  }
  const mode = MACHINE_METHOD_MODES[method];
  if (requestedMode != null && requestedMode !== '') {
    if (!POS_PAYMENT_MODES.includes(requestedMode as PosPaymentMode)) {
      throw new AppError(400, 'payment_mode must be CARD or QR', 'VALIDATION_ERROR');
    }
    if (mode !== null && requestedMode !== mode) {
      throw new AppError(400, `payment_mode ${requestedMode} doesn't match the ${method} payment`, 'VALIDATION_ERROR');
    }
    return requestedMode as PosPaymentMode;
  }
  return mode;
}

/**
 * Rejects (400 AMOUNT_PAYLOAD_MISMATCH) a terminal amount that differs from
 * what the replayed payment will record as collected on the machine: the
 * payload's own leg for its method (Card / UPI / Payment Machine), which
 * must also equal paid_amount minus the eWallet the payload redeems (the
 * frontend folds the eWallet portion into paid_amount). A payload with any
 * other money leg (a split, a cleared prior due folded in) is rejected too.
 * Without this the customer could be charged the eWallet portion a second
 * time on the card, or an amount the replay never records.
 */
export function assertPosAmountMatchesPayload(amount: number, payload: MachinePayload): void {
  const method = String(payload?.payment_method ?? '');
  const legs = Object.entries(payload?.split_details ?? {})
    .filter(([key, value]) => key.toLowerCase() !== 'ewallet' && Number(value) > 0);
  const paid = Number(payload?.paid_amount);
  const ewalletUsed = Math.max(0, Number(payload?.ewallet_used) || 0);
  const leg = payload?.split_details?.[method];
  const expected = round2(paid - ewalletUsed);
  const details = { requestedAmount: amount, paymentMethod: method, paidAmount: payload?.paid_amount ?? null, ewalletUsed, machineLeg: leg ?? null };

  if (legs.length > 1 || (legs.length === 1 && legs[0][0] !== method)) {
    throw new AppError(400, 'A split payment can\'t be sent to the payment machine — use one method for the whole amount', 'AMOUNT_PAYLOAD_MISMATCH', details);
  }
  if (!Number.isFinite(paid) || Math.abs(amount - expected) > PAYLOAD_TOLERANCE
    || (leg != null && Math.abs(amount - Number(leg)) > PAYLOAD_TOLERANCE)) {
    throw new AppError(
      400,
      `The Payment Machine amount (₹${amount}) doesn't match this bill's card/UPI portion` +
        `${Number.isFinite(expected) ? ` (₹${expected})` : ''} — refresh the page and try again.`,
      'AMOUNT_PAYLOAD_MISMATCH',
      details,
    );
  }
}

/**
 * Rejects a Payment Machine charge that would collect more than is owed:
 * 409 NOTHING_DUE when the bill is settled, 409 AMOUNT_EXCEEDS_OUTSTANDING
 * when `amount` plus any eWallet the same payload redeems exceeds the
 * outstanding balance (the frontend folds the eWallet portion into
 * paid_amount, which would otherwise be charged on the card too).
 * A smaller amount is a legitimate partial / split payment.
 */
export async function assertPosAmountWithinOutstanding(
  appointmentId: string,
  salonId: string,
  amount: number,
  payload: { ewallet_used?: number | string | null } | null | undefined,
): Promise<AppointmentOutstanding> {
  const balance = await getAppointmentOutstanding(appointmentId, salonId);
  const ewalletUsed = Math.max(0, Number(payload?.ewallet_used) || 0);
  const details = { ...balance, requestedAmount: amount, ewalletUsed };

  if (balance.outstanding < 0.01) {
    throw new AppError(409, 'Nothing is due on this appointment — it is already fully paid.', 'NOTHING_DUE', details);
  }
  if (amount + ewalletUsed > balance.outstanding + AMOUNT_TOLERANCE) {
    throw new AppError(
      409,
      `Requested ₹${amount}${ewalletUsed > 0 ? ` (+ ₹${ewalletUsed} eWallet)` : ''} exceeds the outstanding balance of ₹${balance.outstanding}.`,
      'AMOUNT_EXCEEDS_OUTSTANDING',
      details,
    );
  }
  return balance;
}
