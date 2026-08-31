import { clientMembershipsRepository } from './client-memberships.repository';
import { membershipsRepository } from '../memberships/memberships.repository';
import { recordTransaction } from '../transactions/transaction-recorder.service';
import pool from '../../config/database';
import type {
  CreateClientMembershipDTO,
  ConsumeSessionDTO,
  ClientMembershipsListQuery,
  ClientMembership,
  WalletDeductionServiceInput,
  WalletDeductionResult,
} from './client-memberships.types';
import logger from '../../config/logger';
import { sendPurchaseReceipt } from '../sales/receipt-send.helper';
import { whatsappAutomationService } from '../whatsapp-automation/whatsapp-automation.service';
import { salonsRepository } from '../salons/salons.repository';
import type { Sale, SaleItem } from '../sales/sales.types';

// Memberships have no real `sales`/`sale_items` rows to attach a receipt to —
// this builds a lightweight in-memory Sale/SaleItem purely to feed the
// existing receipt PDF template.
function buildSyntheticSale(membership: ClientMembership): { sale: Sale; items: SaleItem[] } {
  const now = membership.purchasedAt ?? new Date().toISOString();
  const price = membership.pricePaid ?? 0;

  const sale: Sale = {
    id: membership.id,
    salon_id: membership.salonId,
    client_id: membership.clientId,
    appointment_id: null,
    staff_id: null,
    status: 'completed',
    subtotal: String(price),
    discount_amount: '0',
    tip_amount: '0',
    tip_added_to_salon: false,
    tip_breakdown: null,
    tax_amount: '0',
    ex_charges: '0',
    total_amount: String(price),
    payment_method: null,
    payment_reference: null,
    notes: null,
    invoice_number: null,
    created_by: null,
    created_at: now,
    updated_at: now,
    coupon_code: null,
    discount_percent: null,
    discount_type: null,
    manual_discount_amount: '0',
    coupon_id: null,
    coupon_discount_amount: '0',
    coupon_discount_type: null,
    referral_discount_amount: '0',
    referral_id: null,
    referral_source: null,
  };

  const items: SaleItem[] = [
    {
      id: membership.id,
      sale_id: membership.id,
      item_type: 'membership',
      item_id: membership.membershipId,
      staff_id: null,
      name: membership.membershipName,
      quantity: 1,
      discount_amount: '0',
      unit_price: String(price),
      total_price: String(price),
      tax_amount: '0',
      taxable_amount: String(price),
      created_at: now,
    },
  ];

  return { sale, items };
}

// The PDF receipt is only sent when the membership was purchased standalone
// (includeReceipt=true, from purchase() below) — when it's part of a larger
// checkout (autoCreateFromPayment, called from sales/payments checkout flows),
// that flow already sent one PDF covering the whole sale (service+product+
// membership etc.), so sending this synthetic membership-only PDF too would
// duplicate it.
//
// The membership_purchased text trigger fires only for the same case as the
// PDF above — a genuinely standalone purchase (includeReceipt=true). Sold as
// a line item inside a bigger checkout (autoCreateFromPayment, Quick Sale or
// Calendar), that checkout's own bill_receipt/payment_received message
// already covers it, so this itemized confirmation would just duplicate it.
// One-line description of what this membership actually gives the client —
// varies by pricingType (see memberships.types.ts's discriminated fields).
function buildMembershipBenefitText(membership: ClientMembership): string {
  switch (membership.pricingType) {
    case 'percentage':
      return `${membership.discountPercent ?? 0}% discount on eligible services`;
    case 'value':
      return `₹${membership.membershipWalletBalance ?? 0} wallet balance for eligible services`;
    case 'loyalty':
      return 'Loyalty rewards on eligible services';
    default:
      return 'Exclusive benefits on eligible services';
  }
}

async function notifyMembershipPurchased(membership: ClientMembership, includeReceipt: boolean, invoiceNumber?: string | null): Promise<void> {
  if (!membership.mobile) {
    if (includeReceipt) logger.info(`[WA-AUTO] Skipping purchase receipt for membership ${membership.id} — no mobile number`);
    return;
  }

  if (includeReceipt) {
    whatsappAutomationService.trigger({
      salonId:       membership.salonId,
      eventType:     'membership_purchased',
      clientId:      membership.clientId,
      phone:         membership.mobile,
      countryCode:   null,
      variables: {
        '1': membership.clientName ?? 'Valued Customer',
        '2': membership.membershipName,
        '3': buildMembershipBenefitText(membership),
        '4': membership.purchasedAt ?? '',
        '5': membership.expiresAt ?? '',
        '6': String(membership.pricePaid ?? 0),
        '7': invoiceNumber ?? '—',
      },
      referenceId:   membership.id,
      referenceType: 'membership',
      dedupeByReference: true,
    }).catch(() => {});
  }

  if (!includeReceipt) return;

  const { sale, items } = buildSyntheticSale(membership);
  sendPurchaseReceipt({
    salonId: membership.salonId,
    phone: membership.mobile,
    countryCode: null,
    clientId: membership.clientId,
    clientName: membership.clientName ?? 'Valued Customer',
    sale,
    items,
    appointment: null,
    paidAmount: membership.pricePaid ?? 0,
    dueAmount: 0,
    couponCode: null,
  }).catch(() => {});
}

export const clientMembershipsService = {

  async purchase(salonId: string, dto: CreateClientMembershipDTO) {
    const membership = await clientMembershipsRepository.create(salonId, dto);

    // ── Auto-create sale record so membership revenue appears in reports ────────
    // Mirrors client-packages.service.ts's create() — without this, a membership
    // sold directly (not through an appointment) never shows up in sales/sale_items
    // at all, so any Sales/Revenue page built from those tables misses it entirely.
    // Captured outside the try so the WhatsApp trigger below (Membership
    // Purchased) can include the real invoice number without a second lookup.
    let invoiceNumber: string | null = null;
    try {
      const pricePaid = Number(membership.pricePaid || 0);
      const txn = await recordTransaction({
        salon_id:      salonId,
        client_id:     dto.clientId,
        origin:        'membership_purchase',
        payment_label: dto.paymentMethod || '',
        split_details: dto.splitDetails ?? undefined,
        staff_id:      dto.staffId,
        items: [{
          item_type:  'membership',
          item_id:    dto.membershipId,
          name:       membership.membershipName,
          quantity:   1,
          unit_price: pricePaid,
          // Pre-existing behavior: standalone membership purchases don't
          // compute GST at all (no tax_amount passed to recordTransaction
          // above either) — preserved as-is here, out of scope for this
          // per-item-tax ticket to also start taxing this flow.
          tax_amount: 0,
          taxable_amount: pricePaid,
          staff_id: dto.staffId,
        }],
      });

      // Link this membership row to its invoice-bearing sale so a Member
      // Sale report can show invoice_no via a join.
      await clientMembershipsRepository.setSaleId(membership.id, salonId, txn.sale.id);
      invoiceNumber = txn.sale.invoice_number;
    } catch (err) {
      logger.error('[clientMembershipsService] Failed to auto-create sale for membership purchase:', { error: err });
    }

    notifyMembershipPurchased(membership, true, invoiceNumber).catch(() => {});
    return membership;
  },

  async list(salonId: string, query: ClientMembershipsListQuery) {
    return clientMembershipsRepository.list(salonId, query);
  },

  async getById(id: string, salonId: string) {
    return clientMembershipsRepository.findById(id, salonId);
  },

  async consume(id: string, salonId: string, dto: ConsumeSessionDTO) {
    const updated = await clientMembershipsRepository.consumeSession(id, salonId, dto);

    // ── WhatsApp Automation: Membership Session Used (every redemption) ────
    if (updated?.mobile) {
      (async () => {
        const salon = await salonsRepository.findById(salonId);
        const perSessionValue = updated.totalSessions > 0
          ? (updated.pricePaid ?? 0) / updated.totalSessions
          : 0;
        whatsappAutomationService.trigger({
          salonId,
          eventType:     'membership_session_used',
          clientId:      updated.clientId,
          phone:         updated.mobile!,
          countryCode:   null,
          variables: {
            '1': updated.clientName ?? 'Valued Customer',
            '2': dto.serviceName ?? 'your service',
            '3': perSessionValue.toFixed(0),
            '4': String(updated.membershipWalletBalance ?? 0),
            '5': salon?.business_name ?? 'our salon',
          },
          referenceId:   `${updated.id}:${updated.usedSessions}`,
          referenceType: 'membership',
          dedupeByReference: true,
        }).catch(() => {});
      })().catch(() => {});
    }

    return updated;
  },

  async cancel(id: string, salonId: string) {
    return clientMembershipsRepository.cancel(id, salonId);
  },

  // Automatic wallet redemption at checkout: draws from ALL of the client's
  // active memberships with a balance, highest-balance first, moving to the
  // next one once the current is exhausted. No-op (all zeros) if the client
  // has no active membership with a positive balance.
  async deductWalletForBooking(
    salonId: string,
    clientId: string,
    appointmentId: string,
    services: WalletDeductionServiceInput[],
    maxTotalAmount?: number,
  ): Promise<WalletDeductionResult> {
    const memberships = await clientMembershipsRepository.findAllActiveWithBalanceForClient(clientId, salonId);
    if (memberships.length === 0) return { totalWalletUsed: 0, remainingBalance: 0, perService: [], reused: false };
    const result = await clientMembershipsRepository.deductWalletAcrossMemberships(
      memberships.map((m) => m.id), salonId, { appointmentId, services, maxTotalAmount },
    );

    // ── WhatsApp Automation: Membership Session Used (every redemption) ────
    const spender = memberships[0];
    if (result.totalWalletUsed > 0 && spender?.mobile) {
      (async () => {
        const salon = await salonsRepository.findById(salonId);
        whatsappAutomationService.trigger({
          salonId,
          eventType:     'membership_session_used',
          clientId,
          phone:         spender.mobile!,
          countryCode:   null,
          variables: {
            '1': spender.clientName ?? 'Valued Customer',
            '2': services[0]?.serviceName ?? 'your service',
            '3': result.totalWalletUsed.toFixed(0),
            '4': result.remainingBalance.toFixed(0),
            '5': salon?.business_name ?? 'our salon',
          },
          referenceId:   `${appointmentId}:wallet`,
          referenceType: 'appointment',
          dedupeByReference: true,
        }).catch(() => {});
      })().catch(() => {});
    }

    return result;
  },

  // Gate for whether payments.service.ts should include service/product items
  // in the wallet-deduction input, per the client's active memberships' own
  // applies_to setting.
  async getWalletCoverage(salonId: string, clientId: string): Promise<{
    coversServices: boolean; coversProducts: boolean;
    serviceCategoryIds: string[] | null; productCategoryIds: string[] | null;
    serviceItemIds: string[] | null; productItemIds: string[] | null;
  }> {
    return clientMembershipsRepository.getWalletCoverageForClient(clientId, salonId);
  },

  // Backfill: scan paid appointments and completed sales to create missing client_membership records
  async syncFromAppointments(salonId: string): Promise<{ created: number; skipped: number; debug?: any }> {
    let created = 0;
    let skipped = 0;
    const debugInfo: any = {};
    try {
      // ── Step 1: diagnostic — how many paid appointments with membership_items exist? ──
      const diagAppts = await pool.query(
        `SELECT COUNT(*) AS cnt FROM appointments a
         WHERE a.salon_id = $1
           AND a.client_id IS NOT NULL
           AND a.membership_items IS NOT NULL
           AND jsonb_array_length(a.membership_items) > 0`,
        [salonId],
      );
      debugInfo.appts_with_mem_items = parseInt(diagAppts.rows[0]?.cnt ?? '0', 10);

      const diagPaid = await pool.query(
        `SELECT COUNT(*) AS cnt FROM appointments a
         WHERE a.salon_id = $1
           AND a.client_id IS NOT NULL
           AND a.membership_items IS NOT NULL
           AND jsonb_array_length(a.membership_items) > 0
           AND EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.status = 'completed')`,
        [salonId],
      );
      debugInfo.appts_paid_with_mem_items = parseInt(diagPaid.rows[0]?.cnt ?? '0', 10);

      const diagSales = await pool.query(
        `SELECT COUNT(*) AS cnt FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE s.salon_id = $1 AND s.status = 'completed'
           AND si.item_type = 'membership' AND s.client_id IS NOT NULL`,
        [salonId],
      );
      debugInfo.sale_mem_items = parseInt(diagSales.rows[0]?.cnt ?? '0', 10);

      logger.info('[client-memberships/sync] diagnostic:', debugInfo);

      // ── Step 2: process paid appointments with membership_items ──────────────
      const { rows: appts } = await pool.query(
        `SELECT DISTINCT a.id, a.client_id, a.membership_items
         FROM appointments a
         WHERE a.salon_id = $1
           AND a.client_id IS NOT NULL
           AND a.membership_items IS NOT NULL
           AND jsonb_array_length(a.membership_items) > 0
           AND EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.status = 'completed')`,
        [salonId],
      );

      for (const appt of appts) {
        const items: any[] = Array.isArray(appt.membership_items) ? appt.membership_items : [];
        for (const item of items) {
          try {
            // Resolve membership: try by ID first, then by name
            let mem = await pool.query(
              `SELECT id, name, colour, session_type, number_of_sessions
               FROM memberships
               WHERE salon_id = $1
                 AND (id::text = $2 OR (($2 IS NULL OR $2 = '') AND LOWER(name) = LOWER($3)))
               LIMIT 1`,
              [salonId, item.membership_id || null, item.name || ''],
            );
            if (!mem.rows.length && item.name) {
              mem = await pool.query(
                `SELECT id, name, colour, session_type, number_of_sessions
                 FROM memberships WHERE salon_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
                [salonId, item.name],
              );
            }
            if (!mem.rows.length) { skipped++; continue; }
            const m = mem.rows[0];

            const existing = await pool.query(
              `SELECT 1 FROM client_memberships
               WHERE client_id = $1 AND membership_id = $2 AND salon_id = $3 AND status = 'active' LIMIT 1`,
              [appt.client_id, m.id, salonId],
            );
            if (existing.rows.length) { skipped++; continue; }

            // Get client info
            const cRes = await pool.query(
              `SELECT COALESCE(full_name, first_name || ' ' || COALESCE(last_name,'')) AS name,
                      phone_number, email FROM clients WHERE id = $1 LIMIT 1`,
              [appt.client_id],
            );
            const c = cRes.rows[0];
            const totalSessions = m.session_type === 'limited' ? (Number(m.number_of_sessions) || 0) : 0;
            const pricePaid = Number(item.price || 0) * Math.max(1, Number(item.quantity || 1));

            await pool.query(
              `INSERT INTO client_memberships
                 (id, salon_id, client_id, client_name, mobile, email,
                  membership_id, membership_name, colour, total_sessions, used_sessions,
                  expires_at, status, price_paid)
               VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,0,NULL,'active',$10)`,
              [salonId, appt.client_id, c?.name ?? '', c?.phone_number ?? null, c?.email ?? null,
               m.id, m.name, m.colour, totalSessions, pricePaid],
            );
            created++;
          } catch (err: any) {
            logger.warn('[sync] appt item error:', err?.message ?? err);
            skipped++;
          }
        }
      }

      // ── Step 3: process sale_items with membership type ──────────────────────
      const { rows: saleItems } = await pool.query(
        `SELECT si.item_id, si.name, si.unit_price, si.quantity, s.client_id
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE s.salon_id = $1 AND s.status = 'completed'
           AND si.item_type = 'membership' AND s.client_id IS NOT NULL`,
        [salonId],
      );

      for (const row of saleItems) {
        try {
          let mem = await pool.query(
            `SELECT id, name, colour, session_type, number_of_sessions FROM memberships
             WHERE salon_id = $1 AND (id::text = $2 OR ($2 IS NULL AND LOWER(name) = LOWER($3)))
             LIMIT 1`,
            [salonId, row.item_id || null, row.name || ''],
          );
          if (!mem.rows.length && row.name) {
            mem = await pool.query(
              `SELECT id, name, colour, session_type, number_of_sessions FROM memberships
               WHERE salon_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
              [salonId, row.name],
            );
          }
          if (!mem.rows.length) { skipped++; continue; }
          const m = mem.rows[0];

          const existing = await pool.query(
            `SELECT 1 FROM client_memberships
             WHERE client_id = $1 AND membership_id = $2 AND salon_id = $3 AND status = 'active' LIMIT 1`,
            [row.client_id, m.id, salonId],
          );
          if (existing.rows.length) { skipped++; continue; }

          const cRes = await pool.query(
            `SELECT COALESCE(full_name, first_name || ' ' || COALESCE(last_name,'')) AS name,
                    phone_number, email FROM clients WHERE id = $1 LIMIT 1`,
            [row.client_id],
          );
          const c = cRes.rows[0];
          const totalSessions = m.session_type === 'limited' ? (Number(m.number_of_sessions) || 0) : 0;
          const pricePaid = Number(row.unit_price || 0) * Math.max(1, Number(row.quantity || 1));

          await pool.query(
            `INSERT INTO client_memberships
               (id, salon_id, client_id, client_name, mobile, email,
                membership_id, membership_name, colour, total_sessions, used_sessions,
                expires_at, status, price_paid)
             VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,0,NULL,'active',$10)`,
            [salonId, row.client_id, c?.name ?? '', c?.phone_number ?? null, c?.email ?? null,
             m.id, m.name, m.colour, totalSessions, pricePaid],
          );
          created++;
        } catch (err: any) {
          logger.warn('[sync] sale item error:', err?.message ?? err);
          skipped++;
        }
      }

      logger.info(`[client-memberships/sync] done — created=${created} skipped=${skipped}`, debugInfo);
    } catch (err: any) {
      logger.error('[client-memberships/sync] fatal error:', err?.message ?? err);
      debugInfo.fatalError = err?.message ?? String(err);
    }
    return { created, skipped, debug: debugInfo };
  },

  // Diagnostic: show what data exists in the DB for this salon
  async debugInfo(salonId: string) {
    const [apptTotal, apptWithMem, apptPaidWithMem, apptSamples, pmtSamples, saleMem] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS cnt FROM appointments WHERE salon_id = $1`, [salonId]),
      pool.query(
        `SELECT COUNT(*) AS cnt FROM appointments
         WHERE salon_id = $1 AND membership_items IS NOT NULL AND jsonb_array_length(membership_items) > 0`,
        [salonId],
      ),
      pool.query(
        `SELECT COUNT(*) AS cnt FROM appointments a
         WHERE a.salon_id = $1
           AND a.membership_items IS NOT NULL AND jsonb_array_length(a.membership_items) > 0
           AND EXISTS (SELECT 1 FROM payments p WHERE p.appointment_id = a.id AND p.status = 'completed')`,
        [salonId],
      ),
      // Sample appointments with membership_items
      pool.query(
        `SELECT a.id, a.client_id, a.membership_items,
                (SELECT p.status FROM payments p WHERE p.appointment_id = a.id LIMIT 1) AS payment_status,
                (SELECT p.appointment_id FROM payments p WHERE p.appointment_id = a.id LIMIT 1) AS linked_payment
         FROM appointments a
         WHERE a.salon_id = $1 AND a.membership_items IS NOT NULL AND jsonb_array_length(a.membership_items) > 0
         LIMIT 5`,
        [salonId],
      ),
      // Sample payments with appointment_id
      pool.query(
        `SELECT id, appointment_id, client_id, status, created_at
         FROM payments WHERE salon_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [salonId],
      ),
      // Sale items with membership type
      pool.query(
        `SELECT COUNT(*) AS cnt FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.salon_id = $1 AND si.item_type = 'membership'`,
        [salonId],
      ),
    ]);
    return {
      total_appointments:                parseInt(apptTotal.rows[0]?.cnt ?? '0', 10),
      appointments_with_membership_items: parseInt(apptWithMem.rows[0]?.cnt ?? '0', 10),
      paid_appointments_with_memberships: parseInt(apptPaidWithMem.rows[0]?.cnt ?? '0', 10),
      sale_membership_items:              parseInt(saleMem.rows[0]?.cnt ?? '0', 10),
      sample_appointments_with_memberships: apptSamples.rows,
      recent_payments:                    pmtSamples.rows,
    };
  },

  // Fire-and-forget: called from payments.service when membership is sold
  async autoCreateFromPayment(
    salonId: string,
    clientId: string,
    membershipId: string,
    membershipName: string,
    totalSessions: number,
    pricePaid: number,
    colour?: string,
    expiresAt?: string,
    appointmentId?: string,
    // Staff on the checkout appointment, and the sales row the checkout's own
    // recordTransaction() call already created for this bill — passed through
    // so a Member Sale report can show Staff/Invoice No for memberships sold
    // as a line item on a bill, not just via the standalone purchase() flow.
    staffId?: string,
    saleId?: string,
  ): Promise<void> {
    logger.info(`[client-memberships/auto-create] salon=${salonId} client=${clientId} membership=${membershipId} name="${membershipName}" sessions=${totalSessions} price=${pricePaid}`);
    try {
      const existing = await clientMembershipsRepository.findActiveByClientAndMembership(clientId, membershipId, salonId);
      if (existing) {
        logger.info(`[client-memberships/auto-create] already active (id=${existing.id}) — renewing instead of creating a duplicate`);
        await clientMembershipsRepository.renew(existing.id, salonId, {
          membershipId, pricePaid, totalSessions, staffId, saleId,
        });
        logger.info(`[client-memberships/auto-create] RENEWED — client=${clientId}, membership=${membershipName}`);
        return;
      }
      const created = await clientMembershipsRepository.create(salonId, {
        clientId,
        membershipId,
        membershipName,
        colour,
        totalSessions,
        pricePaid,
        expiresAt,
        appointmentId,
        staffId,
      });
      if (saleId) {
        await clientMembershipsRepository.setSaleId(created.id, salonId, saleId);
      }
      logger.info(`[client-memberships/auto-create] SUCCESS — client=${clientId}, membership=${membershipName}`);
      // No confirmation message here — the calling checkout flow (sales/
      // payments) already sent one covering this whole sale, membership
      // line included (bill_receipt for Quick Sale, payment_received for
      // Calendar). See notifyMembershipPurchased's own comment.
    } catch (err: any) {
      logger.warn('[client-memberships/auto-create] FAILED:', err?.message ?? err);
    }
  },
};
