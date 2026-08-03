import { clientPackagesRepository } from "./client-packages.repository";
import { recordTransaction } from "../transactions/transaction-recorder.service";
import { whatsappAutomationService } from "../whatsapp-automation/whatsapp-automation.service";
import { whatsappAutomationRepository } from "../whatsapp-automation/whatsapp-automation.repository";
import { salonsRepository } from "../salons/salons.repository";
import { sendPurchaseReceipt } from "../sales/receipt-send.helper";
import type { Sale, SaleItem } from "../sales/sales.types";
import logger from "../../config/logger";
import type {
  ClientPackage,
  CreateClientPackageDTO,
  UpdateClientPackageDTO,
  CompleteSessionDTO,
  ClientPackagesListQuery,
} from "./client-packages.types";

// Packages have no real `sales`/`sale_items` rows to attach a receipt to —
// this builds a lightweight in-memory Sale/SaleItem[] purely to feed the
// existing receipt PDF template, one line per service included in the package.
function buildSyntheticSale(pkg: ClientPackage): { sale: Sale; items: SaleItem[] } {
  const sale: Sale = {
    id: pkg.id,
    salon_id: pkg.salonId,
    client_id: pkg.clientId,
    appointment_id: null,
    staff_id: null,
    status: "completed",
    subtotal: String(pkg.basePrice ?? 0),
    discount_amount: String(pkg.discount ?? 0),
    tip_amount: "0",
    tax_amount: String(pkg.gstAmount ?? 0),
    ex_charges: "0",
    total_amount: String(pkg.totalAmount ?? 0),
    payment_method: (pkg.paymentMethod?.toLowerCase() as any) ?? null,
    payment_reference: null,
    notes: null,
    invoice_number: null,
    created_by: null,
    created_at: pkg.createdDate,
    updated_at: pkg.createdDate,
    coupon_code: null,
    discount_percent: null,
    discount_type: null,
  };

  const items: SaleItem[] =
    pkg.services && pkg.services.length > 0
      ? pkg.services.map((s, idx) => ({
          id: `${pkg.id}-${idx}`,
          sale_id: pkg.id,
          item_type: "service" as const,
          item_id: s.serviceId,
          staff_id: null,
          name: s.serviceName,
          quantity: s.totalSessions || 1,
          discount_amount: "0",
          unit_price: String(s.price ?? 0),
          total_price: String((s.price ?? 0) * (s.totalSessions || 1)),
          // This synthetic multi-service breakdown has no real per-service tax
          // split (the package's real tax was only ever computed on the whole
          // package, see pkg.gstAmount below) — receipt display only, ₹0 here.
          tax_amount: "0",
          taxable_amount: "0",
          created_at: pkg.createdDate,
        }))
      : [
          {
            id: pkg.id,
            sale_id: pkg.id,
            item_type: "service" as const,
            item_id: null,
            staff_id: null,
            name: pkg.packageName,
            quantity: 1,
            discount_amount: String(pkg.discount ?? 0),
            unit_price: String(pkg.basePrice ?? 0),
            total_price: String(pkg.totalAmount ?? 0),
            tax_amount: String(pkg.gstAmount ?? 0),
            taxable_amount: String((pkg.basePrice ?? 0) - (pkg.discount ?? 0)),
            created_at: pkg.createdDate,
          },
        ];

  return { sale, items };
}

// Fires once when a package's total remaining sessions (across all its
// services) first drops to this threshold — never on every subsequent visit,
// dedup'd via wa_automation_logs keyed on the package id + event type.
const SESSIONS_REMAINING_THRESHOLD = 2;

async function notifySessionsRemainingIfLow(pkg: ClientPackage): Promise<void> {
  if (!pkg.mobile) return;

  const totalSessions  = pkg.services.reduce((sum, s) => sum + s.totalSessions, 0);
  const totalRemaining = pkg.services.reduce((sum, s) => sum + s.remainingSessions, 0);
  if (totalSessions === 0 || totalRemaining === 0 || totalRemaining > SESSIONS_REMAINING_THRESHOLD) return;

  const alreadyNotified = await whatsappAutomationRepository.logExistsForReference(pkg.id, "sessions_remaining");
  if (alreadyNotified) return;

  whatsappAutomationService.trigger({
    salonId:       pkg.salonId,
    eventType:     "sessions_remaining",
    clientId:      pkg.clientId,
    phone:         pkg.mobile,
    countryCode:   null,
    variables: {
      "1": pkg.clientName ?? "Valued Customer",
      "2": pkg.packageName,
      "3": String(totalRemaining),
    },
    referenceId:   pkg.id,
    referenceType: "package",
  }).catch(() => {});
}

export const clientPackagesService = {

  async list(
    salonId: string,
    query: ClientPackagesListQuery,
  ): Promise<{ items: ClientPackage[]; total: number }> {
    return clientPackagesRepository.list(salonId, query);
  },

  async getById(id: string, salonId: string): Promise<ClientPackage> {
    const pkg = await clientPackagesRepository.findById(id, salonId);
    if (!pkg) throw { statusCode: 404, message: "Client package not found" };
    return pkg;
  },

  async create(salonId: string, dto: CreateClientPackageDTO): Promise<ClientPackage> {
    const pkg = await clientPackagesRepository.create(salonId, dto);

    // ── Auto-create sale record so package revenue appears in dashboard ────────
    try {
      const gstAmt      = Number(pkg.gstAmount  || 0);
      const discountAmt = Number(pkg.discount    || 0);
      const txn = await recordTransaction({
        salon_id:        salonId,
        client_id:       dto.clientId,
        origin:          "package_purchase",
        payment_label:   dto.paymentMethod,
        split_details:   dto.splitDetails ?? undefined,
        discount_amount: discountAmt,
        tax_amount:      gstAmt,
        staff_id:        dto.staffId,
        items: [{
          item_type:       "package",
          name:            pkg.packageName,
          quantity:        1,
          unit_price:      Number(pkg.basePrice || 0) + discountAmt,
          discount_amount: discountAmt,
          // Single-item sale — the package's own already-computed GST (see
          // client-packages.repository.ts) is trivially this one item's tax.
          tax_amount:      gstAmt,
          taxable_amount:  Number(pkg.basePrice || 0),
          staff_id:        dto.staffId,
        }],
      });

      // Link this package row to its invoice-bearing sale so the Package
      // Sale report can show invoice_no via a join.
      await clientPackagesRepository.setSaleId(pkg.id, salonId, txn.sale.id);
    } catch (err) {
      logger.error('[clientPackagesService] Failed to auto-create sale for package purchase:', { error: err });
    }

    // ── WhatsApp Automation: Membership / Package Purchased ───────────────────
    // mobile field on ClientPackage is the client's phone number
    if (pkg.mobile) {
      const salon = await salonsRepository.findById(pkg.salonId);
      whatsappAutomationService.trigger({
        salonId:       pkg.salonId,
        eventType:     "package_purchased",
        clientId:      pkg.clientId,
        phone:         pkg.mobile,
        countryCode:   null,   // client-packages doesn't store country code separately
        variables: {
          "1": pkg.clientName  ?? "Valued Customer",
          "2": salon?.business_name ?? "our salon",
          "3": pkg.packageName,
        },
        referenceId:   pkg.id,
        referenceType: "package",
        dedupeByReference: true,
      }).catch(() => {});

      // PDF receipt as a WhatsApp document attachment — best-effort, only
      // deliverable within 24h of the customer's last message.
      const { sale, items } = buildSyntheticSale(pkg);
      sendPurchaseReceipt({
        salonId:     pkg.salonId,
        phone:       pkg.mobile,
        countryCode: null,
        clientId:    pkg.clientId,
        clientName:  pkg.clientName ?? "Valued Customer",
        sale,
        items,
        appointment: null,
        paidAmount:  pkg.paidAmount ?? 0,
        dueAmount:   pkg.pendingAmount ?? 0,
        couponCode:  null,
      }).catch(() => {});
    } else {
      logger.info(`[WA-AUTO] Skipping package_purchased for package ${pkg.id} — no mobile number`)
    }

    return pkg;
  },

  async update(id: string, salonId: string, dto: UpdateClientPackageDTO): Promise<ClientPackage> {
    const pkg = await clientPackagesRepository.update(id, salonId, dto);
    if (!pkg) throw { statusCode: 404, message: "Client package not found" };
    return pkg;
  },

  async delete(id: string, salonId: string): Promise<void> {
    const deleted = await clientPackagesRepository.delete(id, salonId);
    if (!deleted) throw { statusCode: 404, message: "Client package not found" };
  },

  async completeSession(
    packageId: string,
    salonId:   string,
    dto:       CompleteSessionDTO,
  ): Promise<ClientPackage> {
    const updated = await clientPackagesRepository.completeSession(packageId, salonId, dto);
    if (!updated) throw { statusCode: 404, message: "Client package not found" };

    notifySessionsRemainingIfLow(updated).catch(() => {});

    return updated;
  },

  // Called from payments.service.ts when a bill containing package_items is
  // fully settled — creates the client's actual, redeemable package record.
  // Goes straight to the repository (not this module's own create()), since
  // that would also call recordTransaction() and double-count revenue that
  // the checkout's own sale record already covers — mirrors
  // clientMembershipsService.autoCreateFromPayment()'s same reasoning.
  async autoCreateFromPayment(
    salonId:      string,
    clientId:     string,
    packageName:  string,
    services:     Array<{ serviceId?: string; serviceName: string; totalSessions: number; price: number }>,
    basePrice:    number,
    discount:     number,
    gstPercentage: number,
    expiryDate:   string,
    appointmentId?: string,
    // Staff on the checkout appointment, and the sales row the checkout's own
    // recordTransaction() call already created for this bill — passed through
    // so the Package Sale report can show Staff/Invoice No for packages sold
    // as a line item on a bill, not just via the standalone Create Package form.
    staffId?:     string,
    saleId?:      string,
  ): Promise<void> {
    logger.info(`[client-packages/auto-create] salon=${salonId} client=${clientId} name="${packageName}" services=${services.length} price=${basePrice}`);
    try {
      // Resolve the real method the client paid with off the linked sale —
      // this flow has no payment method of its own at creation time (see
      // the comment above), and "included_in_sale" as a stored value used to
      // leak straight through to the Package Sale report/receipts instead of
      // ever being resolved to cash/card/upi/etc.
      const paymentMethod = saleId
        ? (await clientPackagesRepository.getSalePaymentMethod(saleId, salonId)) ?? "included_in_sale"
        : "included_in_sale";
      const created = await clientPackagesRepository.create(salonId, {
        clientId,
        packageName,
        expiryDate,
        basePrice,
        gstPercentage,
        discount,
        paymentMethod,
        services,
        appointmentId,
        staffId,
      });
      if (saleId) {
        await clientPackagesRepository.setSaleId(created.id, salonId, saleId);
      }
      logger.info(`[client-packages/auto-create] SUCCESS — client=${clientId}, package=${packageName}`);
      // Text only, no PDF here — the calling checkout flow (payments) already
      // sent one PDF covering this whole sale, package line included.
      if (created.mobile) {
        const salon = await salonsRepository.findById(salonId);
        whatsappAutomationService.trigger({
          salonId,
          eventType:   "package_purchased",
          clientId:    created.clientId,
          phone:       created.mobile,
          countryCode: null,
          variables: {
            "1": created.clientName ?? "Valued Customer",
            "2": salon?.business_name ?? "our salon",
            "3": created.packageName,
          },
          referenceId:   created.id,
          referenceType: "package",
          dedupeByReference: true,
        }).catch(() => {});
      }
    } catch (err: any) {
      logger.warn('[client-packages/auto-create] FAILED:', err?.message ?? err);
    }
  },
};
