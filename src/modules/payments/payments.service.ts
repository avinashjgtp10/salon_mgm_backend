import { paymentsRepository } from './payments.repository';
import { couponsRepository } from '../coupons/coupons.repository';
import { appointmentsRepository } from '../appointments/appointments.repository';
import { salesRepository } from '../sales/sales.repository';
import { CreatePaymentBody, Payment } from './payments.types';
import type { Appointment } from '../appointments/appointments.types';

export const paymentsService = {

  async create(data: CreatePaymentBody): Promise<Payment> {
    // ── Recompute financial fields from real appointment data ─────────────────
    // This prevents bugs where the frontend sends a wrong gross_amount
    // (e.g., partial-payment amount instead of the full bill total).
    let appt: Appointment | null = null;

    if (data.appointment_id) {
      try {
        appt = await appointmentsRepository.findById(data.appointment_id);
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

    // ── Auto-create sale record when calendar payment is fully completed ───────
    // The dashboard and reports query the `sales` table. Calendar payments
    // (POST /api/v1/payments) bypass the normal checkout flow and never create
    // a sales record, so revenue is invisible to the dashboard without this.
    if (data.appointment_id && data.status === 'completed' && appt) {
      try {
        const existingSale = await salesRepository.findByAppointmentId(data.appointment_id);
        if (!existingSale) {
          // Build sale items from appointment JSONB fields
          const items: Array<{ item_type: 'service' | 'product' | 'membership'; item_id?: string; name: string; quantity: number; unit_price: string }> = [
            ...(appt.services || []).map(s => ({
              item_type: 'service' as const,
              item_id: s.service_id,
              name: s.name || 'Service',
              quantity: Number(s.quantity) || 1,
              unit_price: String(Number(s.price) || 0),
            })),
            ...(appt.package_items || []).map(p => ({
              item_type: 'service' as const,
              item_id: p.package_id,
              name: p.name || 'Package',
              quantity: Number(p.quantity) || 1,
              unit_price: String(Number(p.price) || 0),
            })),
            ...(appt.product_items || []).map(p => ({
              item_type: 'product' as const,
              item_id: p.product_id || undefined,
              name: p.name || 'Product',
              quantity: Number(p.quantity) || 1,
              unit_price: String(Number(p.price) || 0),
            })),
            ...(appt.membership_items || []).map(m => ({
              item_type: 'membership' as const,
              item_id: m.membership_id || undefined,
              name: m.name || 'Membership',
              quantity: Number(m.quantity) || 1,
              unit_price: String(Number(m.price) || 0),
            })),
          ];

          // Fallback: if no priced items found on the appointment, use the net_amount
          if (items.length === 0) {
            items.push({
              item_type: 'service' as const,
              name: appt.title || 'Appointment Service',
              quantity: 1,
              unit_price: String(data.net_amount || data.gross_amount || 0),
            });
          }

          await salesRepository.create({
            salon_id: data.salon_id,
            client_id: data.client_id,
            appointment_id: data.appointment_id,
            staff_id: appt.staff_id || undefined,
            status: 'completed',
            discount_amount: String(data.discount_amount || 0),
            payment_method: data.payment_method as any,
            items,
          }, null);

          // Mark the appointment itself as completed
          await appointmentsRepository.updateStatus(data.appointment_id, 'completed');
        }
      } catch (err) {
        console.error('[paymentsService] Failed to auto-create sale record:', err);
        // Non-fatal: payment is already recorded
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
