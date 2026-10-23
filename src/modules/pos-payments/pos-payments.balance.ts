import { AppError } from '../../middleware/error.middleware';
import { appointmentsRepository } from '../appointments/appointments.repository';
import { computeAppointmentTotals } from '../appointments/appointment-totals';
import { paymentsRepository } from '../payments/payments.repository';
import { getActiveTaxes } from '../settings/tax.util';

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
