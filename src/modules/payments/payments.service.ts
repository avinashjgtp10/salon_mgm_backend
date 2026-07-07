import { paymentsRepository } from './payments.repository';
import { couponsRepository } from '../coupons/coupons.repository';
import { appointmentsRepository } from '../appointments/appointments.repository';
import { salesRepository } from '../sales/sales.repository';
import { membershipsRepository } from '../memberships/memberships.repository';
import { clientMembershipsService } from '../client-memberships/client-memberships.service';
import { clientMembershipsRepository } from '../client-memberships/client-memberships.repository';
import { rewardPointsRepository } from '../reward-points/reward-points.repository';
import { ewalletRepository } from '../ewallet/ewallet.repository';
import { CreatePaymentBody, Payment } from './payments.types';
import type { Appointment } from '../appointments/appointments.types';
import logger from '../../config/logger';
import { whatsappAutomationService } from '../whatsapp-automation/whatsapp-automation.service';
import { sendReceiptDocument } from '../sales/receipt-whatsapp.service';
import { salonsRepository } from '../salons/salons.repository';
import { branchesRepository } from '../branches/branches.repository';
import { staffService } from '../staff/staff.service';
import { clientsRepository } from '../clients/clients.repository';

export const paymentsService = {

  async create(data: CreatePaymentBody): Promise<Payment> {
    // ── Recompute financial fields from real appointment data ─────────────────
    // This prevents bugs where the frontend sends a wrong gross_amount
    // (e.g., partial-payment amount instead of the full bill total).
    let appt: Appointment | null = null;
    let rewardPointsRedeemed = 0;
    let rewardPointsValue = 0;
    let ewalletUsedActual = 0;

    const isPackagePayment = (data.payment_method || '').toLowerCase() === 'package';

    if (data.appointment_id && !isPackagePayment) {
      try {
        appt = await appointmentsRepository.findById(data.appointment_id);
        if (appt) {
          // Use Number() guards — JSONB prices can arrive as strings or be undefined
          const qty = (i: any) => Number(i.qty) || Number(i.quantity) || 1;
          const serviceTotal    = (appt.services         || []).reduce((s, i) => s + (Number(i.price) || 0) * qty(i), 0);
          const packageTotal    = (appt.package_items    || []).reduce((s, i) => s + (Number(i.price) || 0) * qty(i), 0);
          const productTotal    = (appt.product_items    || []).reduce((s, i) => s + (Number(i.price) || 0) * qty(i), 0);
          const membershipTotal = (appt.membership_items || []).reduce((s, i) => s + (Number(i.price) || 0) * qty(i), 0);
          const actualBill      = serviceTotal + packageTotal + productTotal + membershipTotal;

          // If the appointment has no priced items, fall through to frontend values
          if (!isFinite(actualBill) || actualBill <= 0) throw new Error('no_priced_items');

          const discount        = Math.max(0, Number(data.discount_amount) || 0);
          const ewalletRequested = Math.max(0, Number(data.ewallet_used)    || 0);

          // ── eWallet: recompute server-side from the client's real balance ──
          // Never trust a ₹ amount sent from the frontend — cap it at what the
          // client actually has, same principle as reward points redemption.
          let ewallet = 0;
          if (data.client_id && ewalletRequested > 0) {
            try {
              const balance = await ewalletRepository.getBalance(data.client_id);
              ewallet = Math.min(ewalletRequested, balance);
            } catch (err: any) {
              logger.warn('[payments] ewallet balance check failed:', err?.message ?? err);
            }
          }
          ewalletUsedActual = ewallet;
          data.ewallet_used = ewallet;

          // ── Membership wallet: redeem against services only ────────────────
          // Manual opt-in — only deducts when the staff checked "Apply
          // Membership" (data.apply_membership_wallet). Deducts once per
          // appointment (idempotent across repeat/partial-payment calls — see
          // deductOrReuseWalletForAppointment); if a PRIOR payment call for
          // this appointment already deducted (checkbox was checked then),
          // that already-spent amount still applies even if this call has the
          // box unchecked — it can't be un-deducted, so the bill stays
          // consistent with what was actually taken from the wallet. Never
          // blocks a payment on a wallet-system error; customer just pays
          // full price in that case.
          let membershipWalletUsed = 0;
          if (data.client_id) {
            try {
              if (data.apply_membership_wallet) {
                const servicesForWallet = (appt.services || []).map(s => ({
                  serviceId:   s.service_id,
                  serviceName: s.name,
                  amount:      (Number(s.price) || 0) * qty(s),
                }));
                if (servicesForWallet.length > 0) {
                  const result = await clientMembershipsService.deductWalletForBooking(
                    data.salon_id, data.client_id, data.appointment_id, servicesForWallet,
                  );
                  membershipWalletUsed = result.totalWalletUsed;
                }
              } else {
                membershipWalletUsed = await clientMembershipsRepository.getWalletUsedForAppointment(data.appointment_id);
              }
            } catch (err: any) {
              logger.warn('[payments] membership wallet deduction failed:', err?.message ?? err);
            }
          }

          // ── Reward points redemption ────────────────────────────────────────
          // Manual opt-in via the checkbox (data.reward_points_redeemed > 0).
          // Recompute the ₹ value server-side from the salon's own configured
          // rate — never trust a discount amount sent from the frontend — and
          // cap it at the client's actual balance so it can't go negative.
          if (data.client_id && Number(data.reward_points_redeemed) > 0) {
            try {
              const config = await rewardPointsRepository.getConfig(data.salon_id);
              const balance = await rewardPointsRepository.getBalance(data.client_id);
              const requested = Math.min(Number(data.reward_points_redeemed), balance);
              if (config.active && config.redeem_points > 0 && requested > 0) {
                rewardPointsRedeemed = requested;
                rewardPointsValue = (requested / config.redeem_points) * config.redeem_value;
              }
            } catch (err: any) {
              logger.warn('[payments] reward points redemption failed:', err?.message ?? err);
            }
          }

          const effectiveBill = Math.max(0, actualBill - discount - ewallet - membershipWalletUsed - rewardPointsValue);
          data.membership_wallet_used = membershipWalletUsed;
          data.reward_points_value    = rewardPointsValue;

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
    } else if (data.appointment_id && isPackagePayment) {
      // Package payments: customer already paid via the package purchase.
      // Trust frontend values (paid=0, due=0, status='completed') and just
      // fetch the appointment so membership auto-create has appt context.
      try { appt = await appointmentsRepository.findById(data.appointment_id); } catch { /* non-fatal */ }
      data.gross_amount = 0;
      data.net_amount   = 0;
      data.paid_amount  = 0;
      data.due_amount   = 0;
      data.status       = 'completed';
    }

    const payment = await paymentsRepository.create(data);

    // ── eWallet: actually deduct the real balance now that the payment row exists ──
    if (data.client_id && ewalletUsedActual > 0) {
      try {
        await ewalletRepository.applyLedgerEntry({
          clientId: data.client_id,
          salonId: data.salon_id,
          type: 'redeem',
          delta: -ewalletUsedActual,
          sourceType: 'payment',
          sourceId: payment.id,
          note: `Used for ₹${ewalletUsedActual.toFixed(2)} payment`,
        });
      } catch (err: any) {
        logger.warn('[payments] ewallet redeem ledger write failed:', err?.message ?? err);
      }
    }

    // ── Reward points: redeem now, earn only once the bill is fully paid ─────
    // Points redeemed already reduced net_amount above; deduct them from the
    // client's balance here now that the payment row exists to link against.
    if (data.client_id && rewardPointsRedeemed > 0) {
      try {
        await rewardPointsRepository.applyLedgerEntry({
          clientId: data.client_id,
          salonId: data.salon_id,
          type: 'redeem',
          delta: -rewardPointsRedeemed,
          sourceType: 'payment',
          sourceId: payment.id,
          note: `Redeemed for ₹${rewardPointsValue.toFixed(2)} off`,
        });
      } catch (err: any) {
        logger.warn('[payments] reward points redeem ledger write failed:', err?.message ?? err);
      }
    }
    // Earn only on a fully-paid bill — a Partial payment doesn't award points
    // yet, since the sale isn't settled (matches how eWallet/wallet are only
    // ever debited, never speculatively credited before the bill is closed).
    if (data.client_id && data.status === 'completed' && !isPackagePayment) {
      try {
        const config = await rewardPointsRepository.getConfig(data.salon_id);
        if (config.active && config.spend_amount > 0) {
          const pointsEarned = Math.floor((Number(data.net_amount) / config.spend_amount) * config.points_earned);
          if (pointsEarned > 0) {
            await rewardPointsRepository.applyLedgerEntry({
              clientId: data.client_id,
              salonId: data.salon_id,
              type: 'earn',
              delta: pointsEarned,
              sourceType: 'payment',
              sourceId: payment.id,
              note: `Earned on ₹${Number(data.net_amount).toFixed(2)} payment`,
            });
          }
        }
      } catch (err: any) {
        logger.warn('[payments] reward points earn ledger write failed:', err?.message ?? err);
      }
    }

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
    // Skip for package payments — revenue was already counted when the package was purchased.
    if (data.appointment_id && data.status === 'completed' && appt && !isPackagePayment) {
      try {
        const existingSale = await salesRepository.findByAppointmentId(data.appointment_id);
        if (!existingSale) {
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

          if (items.length === 0) {
            items.push({
              item_type: 'service' as const,
              name: appt.title || 'Appointment Service',
              quantity: 1,
              unit_price: String(data.net_amount || data.gross_amount || 0),
            });
          }

          const sale = await salesRepository.create({
            salon_id: data.salon_id,
            client_id: data.client_id,
            appointment_id: data.appointment_id,
            staff_id: appt.staff_id || undefined,
            status: 'completed',
            discount_amount: String(data.discount_amount || 0),
            payment_method: data.payment_method as any,
            coupon_code: data.coupon_code || undefined,
            discount_type: appt.discount_type || undefined,
            discount_percent: appt.discount_type === 'percentage' ? String(appt.discount_value ?? 0) : undefined,
            // DB constraint only allows lowercase values ('cash','card','upi','bank_transfer'),
            // but this arrives as the frontend's display label (e.g. "Cash") — normalizing
            // here since the mismatch was silently failing every sale auto-creation.
            payment_method: String(data.payment_method || '').toLowerCase() as any,
            items,
          }, null);

          // Note: appointment.status is managed by the checkout flow
          // (POST /api/v1/appointments/:id/checkout) to avoid double-completion
          // appointment.payment_status is updated above — that's all payments handles here

          // ── WhatsApp Automation: Purchase confirmation (per item type) ──────
          // Fetch enriched sale with client_phone and salon_name
          const enrichedSale = await salesRepository.findById(sale.id);
          if (enrichedSale && data.client_id && (enrichedSale as any).client_phone) {
            const saleItemsForEvents = await salesRepository.findItemsBySaleId(sale.id);
            const presentTypes = new Set(saleItemsForEvents.map((i) => i.item_type));
            const purchaseEvents: Array<{ eventType: 'service_purchased' | 'product_purchased'; itemType: 'service' | 'product' }> = [
              { eventType: 'service_purchased', itemType: 'service' },
              { eventType: 'product_purchased', itemType: 'product' },
            ];

            // membership_purchased is NOT fired here — that's centralized in
            // clientMembershipsService.autoCreateFromPayment(), called below
            // for this same sale's membership_items, so it's never double-fired.
            for (const { eventType, itemType } of purchaseEvents) {
              if (!presentTypes.has(itemType)) continue;
              const itemName = saleItemsForEvents.find((i) => i.item_type === itemType)?.name ?? 'your purchase';
              whatsappAutomationService.trigger({
                salonId:       data.salon_id,
                eventType,
                clientId:      data.client_id,
                phone:         (enrichedSale as any).client_phone,
                countryCode:   (enrichedSale as any).client_phone_code ?? null,
                variables: {
                  '1': (enrichedSale as any).client_name ?? 'Valued Customer',
                  '2': (enrichedSale as any).salon_name   ?? 'our salon',
                  '3': itemName,
                },
                referenceId:   enrichedSale.id,
                referenceType: 'invoice',
              }).catch(() => {});
            }

            // PDF receipt as a WhatsApp document attachment — best-effort, only
            // deliverable within 24h of the customer's last message. Failure here
            // is expected outside that window and never blocks the triggers above.
            (async () => {
              const [salonRecord, branches, staffList, clientRecord] = await Promise.all([
                salonsRepository.findById(data.salon_id),
                branchesRepository.listBySalonId(data.salon_id),
                staffService.list(data.salon_id, { is_active: true, limit: 100 } as any),
                data.client_id ? clientsRepository.findById(data.client_id, data.salon_id) : Promise.resolve(null),
              ]);
              const saleItems = saleItemsForEvents;

              const branch = branches.find((b) => b.is_main) ?? branches[0] ?? null;
              const salonAddress = branch
                ? [branch.address_line1, branch.address_line2, branch.city, branch.state, branch.pincode].filter(Boolean).join(", ")
                : null;

              const staffNames: Record<string, string> = {};
              for (const s of staffList.data as any[]) {
                staffNames[s.id] = [s.first_name, s.last_name].filter(Boolean).join(" ").trim() || s.email;
              }

              await sendReceiptDocument({
                salonId: data.salon_id,
                phone: (enrichedSale as any).client_phone,
                countryCode: (enrichedSale as any).client_phone_code ?? null,
                salon: {
                  business_name: salonRecord?.business_name ?? (enrichedSale as any).salon_name ?? "our salon",
                  logo_url: (salonRecord as any)?.logo_url ?? null,
                  email: salonRecord?.email ?? null,
                  phone: salonRecord?.phone ?? null,
                  website_url: salonRecord?.website_url ?? null,
                  gst_number: salonRecord?.gst_number ?? null,
                },
                salonAddress,
                client: {
                  name: clientRecord?.full_name ?? (enrichedSale as any).client_name ?? "Valued Customer",
                  phone: clientRecord?.phone_number ?? (enrichedSale as any).client_phone ?? null,
                  email: clientRecord?.email ?? null,
                },
                sale: enrichedSale,
                items: saleItems,
                staffNames,
                appointment: appt
                  ? {
                        id: appt.id,
                        scheduledAt: appt.scheduled_at,
                        durationMinutes: appt.duration_minutes,
                        status: appt.status,
                        notes: appt.notes,
                    }
                  : null,
                paidAmount: Number(data.paid_amount) || 0,
                dueAmount: Number(data.due_amount) || 0,
                couponCode: data.coupon_code ?? null,
              });
            })().catch(() => {});
          }
        }
      } catch (err) {
        logger.error('[paymentsService] Failed to auto-create sale record:', { error: err });
        // Non-fatal: payment is already recorded
      }
    }

    // Payment email is handled by appointments.service checkout — skip here to avoid duplicates

    // ── Auto-create client_memberships when memberships are sold ─────────────
    // Use membership_items from DB (appt) if available; fall back to items sent in the payment body.
    // The fallback handles the case where membership was added in the edit UI without saving first,
    // or when the edit_appointments permission blocked the pre-payment PATCH.
    const membershipItemsSrc: Array<any> =
      (appt?.membership_items?.length ? appt.membership_items : null) ??
      (data.membership_items?.length   ? data.membership_items   : null) ??
      [];
    logger.info(`[payments/create] status=${data.status} client_id=${data.client_id} membership_items_src_count=${membershipItemsSrc.length} (db=${appt?.membership_items?.length ?? 0} body=${data.membership_items?.length ?? 0})`);
    if (data.status === 'completed' && data.client_id && membershipItemsSrc.length > 0) {
      for (const item of membershipItemsSrc) {
        const pricePaid = Number(item.price ?? 0) * Number(item.quantity ?? 1);
        // Fire-and-forget — does not block payment return
        (async () => {
          try {
            // Prefer stored membership_id; fall back to name lookup for legacy records
            let membershipId: string | null = item.membership_id ?? null;
            let mem = membershipId
              ? await membershipsRepository.findById(membershipId, data.salon_id)
              : null;
            if (!mem && item.name) {
              mem = await membershipsRepository.findByName(item.name, data.salon_id);
              if (mem) membershipId = mem.id;
            }
            if (!mem || !membershipId) {
              logger.warn(`[payments] could not resolve membership for name="${item.name}" id="${item.membership_id}"`);
              return;
            }
            const totalSessions = mem.sessionType === 'limited' ? (mem.numberOfSessions ?? 0) : 0;
            await clientMembershipsService.autoCreateFromPayment(
              data.salon_id,
              data.client_id!,
              membershipId,
              item.name || mem.name,
              totalSessions,
              pricePaid,
              mem.colour,
            );
          } catch (err: any) {
            logger.warn('[payments] membership auto-create failed:', err?.message ?? err);
          }
        })();
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