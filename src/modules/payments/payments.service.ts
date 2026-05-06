import { paymentsRepository } from './payments.repository';
import { couponsRepository } from '../coupons/coupons.repository';
import { appointmentsRepository } from '../appointments/appointments.repository';
import { CreatePaymentBody, Payment } from './payments.types';

export const paymentsService = {

  async create(data: CreatePaymentBody): Promise<Payment> {
    // ── Recompute financial fields from real appointment data ─────────────────
    // This prevents bugs where the frontend sends a wrong gross_amount
    // (e.g., partial-payment amount instead of the full bill total).
    if (data.appointment_id) {
      try {
        const appt = await appointmentsRepository.findById(data.appointment_id);
        if (appt) {
          // Use Number() guards — JSONB prices can arrive as strings or be undefined
          const serviceTotal    = (appt.services         || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
          const packageTotal    = (appt.package_items    || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
          const productTotal    = (appt.product_items    || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
          const membershipTotal = (appt.membership_items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
          const actualBill      = serviceTotal + packageTotal + productTotal + membershipTotal;

          // If the appointment has no priced items, fall through to frontend values
          if (!isFinite(actualBill) || actualBill <= 0) throw new Error('no_priced_items');

          const discount      = Math.max(0, Number(data.discount_amount) || 0);
          const ewallet       = Math.max(0, Number(data.ewallet_used)    || 0);
          const effectiveBill = Math.max(0, actualBill - discount - ewallet);

          // Sum previously paid amounts across all prior payments for this appointment
          const existingPaid = await paymentsRepository.getTotalPaidForAppointment(data.appointment_id);
          const thisPaid     = Math.max(0, Number(data.paid_amount) || Number(data.net_amount) || Number(data.gross_amount) || 0);

          data.gross_amount = actualBill;
          data.net_amount   = effectiveBill;
          data.paid_amount  = thisPaid;
          data.due_amount   = Math.max(0, parseFloat((effectiveBill - existingPaid - thisPaid).toFixed(2)));
          data.status       = data.due_amount > 0 ? 'partial' : 'completed';
        }
      } catch {
        // Non-fatal: fall through and use frontend-supplied values
      }
    }

    const payment = await paymentsRepository.create(data);

    // Increment coupon used_count
    if (data.coupon_code) {
      const coupon = await couponsRepository.findByCode(data.coupon_code);
      if (coupon) await couponsRepository.incrementUsed(coupon.id);
    }

    // Mark appointment payment_status based on computed due_amount
    if (data.appointment_id) {
      try {
        const apptStatus = (data.due_amount ?? 0) > 0 ? 'partial' : 'paid';
        await appointmentsRepository.updatePaymentStatus(data.appointment_id, apptStatus);
      } catch {
        // Non-fatal: payment is still recorded
      }
    }

    return payment;
  },

  async getByAppointmentId(appointmentId: string): Promise<Payment | null> {
    return paymentsRepository.findByAppointmentId(appointmentId);
  },

  async listBySalon(salonId: string): Promise<Payment[]> {
    return paymentsRepository.findBySalonId(salonId);
  },
};
