import { clientPackagesRepository } from "./client-packages.repository";
import { salesRepository } from "../sales/sales.repository";
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
    total_amount: String(pkg.totalAmount ?? 0),
    payment_method: (pkg.paymentMethod?.toLowerCase() as any) ?? null,
    payment_reference: null,
    notes: null,
    invoice_number: null,
    created_by: null,
    created_at: pkg.createdDate,
    updated_at: pkg.createdDate,
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
      await salesRepository.create({
        salon_id:        salonId,
        client_id:       dto.clientId,
        status:          'completed',
        payment_method:  dto.paymentMethod as any,
        discount_amount: String(discountAmt),
        tax_amount:      String(gstAmt),
        items: [{
          item_type:       'service',
          name:            pkg.packageName,
          quantity:        1,
          unit_price:      String(Number(pkg.basePrice || 0) + discountAmt),
          discount_amount: String(discountAmt),
        }],
      }, null);
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
};
