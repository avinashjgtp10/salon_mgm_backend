import { paymentsRepository } from './payments.repository';
import { couponsRepository } from '../coupons/coupons.repository';
import { appointmentsRepository } from '../appointments/appointments.repository';
import { salesRepository } from '../sales/sales.repository';
import { membershipsRepository } from '../memberships/memberships.repository';
import { clientMembershipsService } from '../client-memberships/client-memberships.service';
import { clientMembershipsRepository } from '../client-memberships/client-memberships.repository';
import { rewardPointsRepository } from '../reward-points/reward-points.repository';
import { ewalletRepository } from '../ewallet/ewallet.repository';
import { referralRepository } from '../referral/referral.repository';
import { CreatePaymentBody, Payment } from './payments.types';
import type { Appointment } from '../appointments/appointments.types';
import logger from '../../config/logger';
import { whatsappAutomationService } from '../whatsapp-automation/whatsapp-automation.service';
import { sendReceiptDocument } from '../sales/receipt-whatsapp.service';
import { salonsRepository } from '../salons/salons.repository';
import { branchesRepository } from '../branches/branches.repository';
import { staffService } from '../staff/staff.service';
import { clientsRepository } from '../clients/clients.repository';
import { getIO } from '../../config/socket';
import { getActiveTaxes, computeExclusiveTaxAddOn } from '../settings/tax.util';

export const paymentsService = {

  async create(data: CreatePaymentBody): Promise<Payment> {
    // ── Recompute financial fields from real appointment data ─────────────────
    // This prevents bugs where the frontend sends a wrong gross_amount
    // (e.g., partial-payment amount instead of the full bill total).
    let appt: Appointment | null = null;
    let ewalletUsedActual = 0;
    let refereeWalletCredit = 0;

    const isPackagePayment = (data.payment_method || '').toLowerCase() === 'package';

    if (data.appointment_id && !isPackagePayment) {
      try {
        appt = await appointmentsRepository.findById(data.appointment_id);
        if (appt) {
          // Use Number() guards — JSONB prices can arrive as strings or be undefined
          const qty = (i: any) => Number(i.qty) || Number(i.quantity) || 1;
          // Prefer each item's own `total` (set by the frontend's per-row "Disc %"
          // field — see ServiceRow.tsx calcTotal()) over price × qty, which is the
          // undiscounted unit price. Packages/products/memberships never send a
          // `total` field (no per-row discount UI for them), so they always fall
          // through to price × qty unchanged. Without this, any per-row service
          // discount was silently dropped here, inflating actualBill/net_amount
          // above what the client was actually charged — the gap then showed up
          // as a phantom due_amount equal to the discount.
          const lineTotal = (i: any) => {
            const t = Number(i.total);
            return (i.total !== undefined && i.total !== null && isFinite(t)) ? t : (Number(i.price) || 0) * qty(i);
          };
          const serviceTotal    = (appt.services         || []).reduce((s, i) => s + lineTotal(i), 0);
          const packageTotal    = (appt.package_items    || []).reduce((s, i) => s + lineTotal(i), 0);
          const productTotal    = (appt.product_items    || []).reduce((s, i) => s + lineTotal(i), 0);
          const membershipTotal = (appt.membership_items || []).reduce((s, i) => s + lineTotal(i), 0);
          const rawSubtotal     = serviceTotal + packageTotal + productTotal + membershipTotal;
          // Rounded to the nearest whole rupee — matches computeTotals() on the
          // frontend (totalsUtils.ts), which is what the client actually sees/
          // pays. Rounding here (not after discount/wallet deductions) keeps
          // gross_amount consistent with the frontend's rounded grandTotal.
          const actualBill      = Math.round(rawSubtotal);

          // If the appointment has no priced items, fall through to frontend values
          if (!isFinite(actualBill) || actualBill <= 0) throw new Error('no_priced_items');

          const frontendDiscount = Math.max(0, Number(data.discount_amount) || 0);
          const ewalletRequested = Math.max(0, Number(data.ewallet_used)    || 0);

          // Sum previously paid amounts across all prior payments for this appointment.
          // Computed early — the referral discount below must only ever apply on the
          // FIRST payment attempt for an appointment, never re-applied on a second
          // (e.g. completing) call for the same bill.
          const existingPaid = await paymentsRepository.getTotalPaidForAppointment(data.appointment_id);

          // ── Refer & Earn: welcome reward for the referred client's first
          // qualifying bill ────────────────────────────────────────────────────
          // If the bill meets min_bill_amount, applied immediately as a price
          // reduction on this bill (like a coupon). If it doesn't, the reward
          // isn't forfeited — it's credited straight to the client's eWallet
          // instead, so a small first visit doesn't cost them the reward.
          // Gated on referral_referee_rewarded (not referral_reward_status,
          // which tracks the REFERRER's separate payout) so this can only ever
          // fire once per referred client, and doesn't block the referrer's
          // own reward from still firing later once a qualifying bill occurs.
          let referralDiscount = 0;
          if (data.client_id && !isPackagePayment && existingPaid === 0) {
            try {
              const referredClient = await clientsRepository.findById(data.client_id, data.salon_id);
              if (referredClient?.referred_by_client_id && !referredClient.referral_referee_rewarded) {
                const refConfig = await referralRepository.getConfig(data.salon_id);
                if (refConfig.active && refConfig.referee_reward_amount > 0) {
                  if (actualBill >= refConfig.min_bill_amount) {
                    referralDiscount = Math.min(refConfig.referee_reward_amount, actualBill);
                  } else {
                    refereeWalletCredit = refConfig.referee_reward_amount;
                    await ewalletRepository.applyLedgerEntry({
                      clientId: data.client_id,
                      salonId: data.salon_id,
                      type: 'topup',
                      delta: refereeWalletCredit,
                      sourceType: 'referral',
                      sourceId: data.client_id,
                      note: `Referral welcome reward — bill below ₹${refConfig.min_bill_amount} minimum for an instant discount, credited to wallet instead`,
                    });
                  }
                  await clientsRepository.markRefereeRewarded(data.client_id);
                }
              }
            } catch (err: any) {
              logger.warn('[payments] referral discount check failed:', err?.message ?? err);
            }
          }
          data.referral_discount_applied = referralDiscount;
          const discount = frontendDiscount + referralDiscount;
          // Persist the combined figure — the sale-creation block below reads
          // data.discount_amount to net revenue, and it must include this
          // referral piece too, same as it already does for coupon/manual.
          data.discount_amount = discount;

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

          // ── Tax: apply the same active/applicable rates + bucket allocation
          // the frontend uses (totalsUtils.ts computeBucketTax) — the amount
          // actually owed must include exclusive tax, not just item prices
          // minus discount. Previously this was skipped entirely here, so the
          // receipt correctly displayed tax but the appointment could be
          // marked "Paid" for less than what was shown to the client.
          let taxAmount = 0;
          try {
            const activeTaxes = await getActiveTaxes(data.salon_id);
            const discRatio = rawSubtotal > 0 ? Math.min(1, discount / rawSubtotal) : 0;
            taxAmount = computeExclusiveTaxAddOn([
              { type: 'service',    base: serviceTotal    - serviceTotal    * discRatio },
              { type: 'packages',   base: packageTotal    - packageTotal    * discRatio },
              { type: 'product',    base: productTotal    - productTotal    * discRatio },
              { type: 'membership', base: membershipTotal - membershipTotal * discRatio },
            ], activeTaxes);
          } catch (err: any) {
            logger.warn('[payments] tax computation failed:', err?.message ?? err);
          }

          // Reward points no longer exist as a separately redeemable balance —
          // earned value is credited straight into eWallet (see the "earn" block
          // below), so there is nothing to redeem here; eWallet redemption above
          // already covers whatever reward money the client has.
          const grandTotal    = Math.round(actualBill - discount + taxAmount);
          const effectiveBill = Math.max(0, grandTotal - ewallet - membershipWalletUsed);
          data.membership_wallet_used = membershipWalletUsed;

          // `|| ` treats 0 as "not provided" and falls through to gross_amount — which
          // silently records the full pre-discount catalog price as "paid" whenever a
          // coupon/wallet/points deduction legitimately brings paid_amount to ₹0 (e.g. a
          // 100%-off coupon), overcharging the customer's recorded payment by the full bill.
          const thisPaid = Math.max(0, (
            data.paid_amount != null ? Number(data.paid_amount)
            : data.net_amount  != null ? Number(data.net_amount)
            : Number(data.gross_amount) || 0
          ));

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

    // ── Reward earnings: credited straight into eWallet, not a separate
    // points balance ────────────────────────────────────────────────────────
    // Reward points and referral credits are both just eWallet money now —
    // one balance, one "Use eWallet" toggle at checkout. The salon's rate is
    // still configured in points-like terms (spend X, earn Y points, Y points
    // = ₹Z) purely so Settings stays familiar; internally that's converted to
    // a ₹ value and credited immediately, same as a referral reward.
    // Earn only on a fully-paid bill — a Partial payment doesn't earn yet,
    // since the sale isn't settled (matches how eWallet/wallet are only ever
    // debited, never speculatively credited before the bill is closed).
    if (data.client_id && data.status === 'completed' && !isPackagePayment) {
      try {
        const config = await rewardPointsRepository.getConfig(data.salon_id);
        if (config.active && config.spend_amount > 0 && config.redeem_points > 0) {
          const pointsEarned = Math.floor((Number(data.net_amount) / config.spend_amount) * config.points_earned);
          const earnedValue = (pointsEarned / config.redeem_points) * config.redeem_value;
          if (earnedValue > 0) {
            await ewalletRepository.applyLedgerEntry({
              clientId: data.client_id,
              salonId: data.salon_id,
              type: 'topup',
              delta: earnedValue,
              sourceType: 'reward',
              sourceId: payment.id,
              note: `Earned on ₹${Number(data.net_amount).toFixed(2)} payment`,
            });
          }
        }
      } catch (err: any) {
        logger.warn('[payments] reward earn ledger write failed:', err?.message ?? err);
      }
    }

    // ── Refer & Earn: credit the referrer's wallet once the referred client's
    // first bill is fully paid ─────────────────────────────────────────────
    // The referee's own reward was already applied above as an instant
    // discount on this same bill — this only handles the referrer's side.
    // Re-fetched fresh rather than reusing state from the block above, because
    // the discount and the completion can happen on different calls: a partial
    // payment gets the discount on call 1 (existingPaid === 0), but the bill
    // might only reach status 'completed' on a later call once the remaining
    // due is cleared — this must still fire then.
    // Gated on referral_reward_status === 'pending' so it can only ever fire
    // once per referred client, regardless of how many payments follow.
    if (data.client_id && data.status === 'completed' && !isPackagePayment) {
      try {
        const referredClient = await clientsRepository.findById(data.client_id, data.salon_id);
        if (referredClient?.referred_by_client_id && referredClient.referral_reward_status === 'pending') {
          const config = await referralRepository.getConfig(data.salon_id);
          const billAmount = Number(data.gross_amount) || 0;
          if (config.active && billAmount >= config.min_bill_amount) {
            if (config.referrer_reward_amount > 0) {
              await ewalletRepository.applyLedgerEntry({
                clientId: referredClient.referred_by_client_id,
                salonId: data.salon_id,
                type: 'topup',
                delta: config.referrer_reward_amount,
                sourceType: 'referral',
                sourceId: data.client_id,
                note: 'Referral reward for referring a new customer',
              });
            }
            await clientsRepository.markReferralRewarded(data.client_id);
          }
        }
      } catch (err: any) {
        logger.warn('[payments] referral reward crediting failed:', err?.message ?? err);
      }
    }

    // Increment coupon used_count
    if (data.coupon_code) {
      const coupon = await couponsRepository.findByCodeForSalon(data.coupon_code, data.salon_id);
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
          const items: Array<{ item_type: 'service' | 'product' | 'membership'; item_id?: string; staff_id?: string; name: string; quantity: number; unit_price: string }> = [
            ...(appt.services || []).map(s => ({
              item_type: 'service' as const,
              item_id: s.service_id,
              staff_id: s.staff_id || undefined,
              name: s.name || 'Service',
              quantity: Number(s.quantity) || 1,
              unit_price: String(Number(s.price) || 0),
            })),
            ...(appt.package_items || []).map(p => ({
              item_type: 'service' as const,
              item_id: p.package_id,
              staff_id: p.staff_id || undefined,
              name: p.name || 'Package',
              quantity: Number(p.quantity) || 1,
              unit_price: String(Number(p.price) || 0),
            })),
            ...(appt.product_items || []).map(p => ({
              item_type: 'product' as const,
              item_id: p.product_id || undefined,
              staff_id: p.staff_id || undefined,
              name: p.name || 'Product',
              quantity: Number(p.quantity) || 1,
              unit_price: String(Number(p.price) || 0),
            })),
            ...(appt.membership_items || []).map(m => ({
              item_type: 'membership' as const,
              item_id: m.membership_id || undefined,
              staff_id: m.staff_id || undefined,
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
            // Membership wallet usage must reduce recognized revenue here — that
            // money was already counted as revenue when the membership itself was
            // purchased. Without this, every visit that draws down the wallet
            // counts the same money as revenue a second time. (eWallet, by
            // contrast, is correctly NOT subtracted — top-ups and referral
            // credits are never counted as revenue when added, only when spent.)
            discount_amount: String((Number(data.discount_amount) || 0) + (Number(data.membership_wallet_used) || 0)),
            // DB constraint only allows lowercase values ('cash','card','upi','bank_transfer'),
            // but this arrives as the frontend's display label (e.g. "Cash") — normalizing
            // here since the mismatch was silently failing every sale auto-creation.
            payment_method: String(data.payment_method || '').toLowerCase() as any,
            coupon_code: data.coupon_code || undefined,
            discount_type: appt.discount_type || undefined,
            discount_percent: appt.discount_type === 'percentage' ? String(appt.discount_value ?? 0) : undefined,
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

    // Live calendar sync — appointments.service.ts already does this for
    // create/cancel via notificationsService.create() (which also writes a
    // bell notification row). A payment happens far more often than a
    // create/cancel, so this uses a lighter direct socket emit instead —
    // same "push to everyone in the salon room" mechanism, no DB row, no
    // bell spam on every checkout. useBookings.ts listens for this alongside
    // the "notification" event to refetch the visible calendar range.
    try {
      getIO().to(`salon:${data.salon_id}`).emit('payment_updated', {
        appointment_id: data.appointment_id,
        salon_id: data.salon_id,
      });
    } catch {
      // socket not ready — ignore, client will see it on next manual refresh
    }

    return refereeWalletCredit > 0 ? { ...payment, referral_wallet_credited: refereeWalletCredit } : payment;
  },

  async getByAppointmentId(appointmentId: string): Promise<Payment | null> {
    return paymentsRepository.findByAppointmentId(appointmentId);
  },

  async listBySalon(salonId: string): Promise<Payment[]> {
    return paymentsRepository.findBySalonId(salonId);
  },
};