import { clientPackagesRepository } from "./client-packages.repository";
import { recordTransaction } from "../transactions/transaction-recorder.service";
import { sendPurchaseReceipt } from "../sales/receipt-send.helper";
import { appointmentsService } from "../appointments/appointments.service";
import { getPackageNoShowPolicy } from "./package-settings.util";
import { whatsappAutomationService } from "../whatsapp-automation/whatsapp-automation.service";
import { waScheduledMessagesService } from "../whatsapp-automation/wa-scheduled-messages.service";
import { salonsRepository } from "../salons/salons.repository";
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
    tip_added_to_salon: false,
    tip_breakdown: null,
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
    manual_discount_amount: '0',
    coupon_id: null,
    coupon_discount_amount: '0',
    coupon_discount_type: null,
    referral_discount_amount: '0',
    referral_id: null,
    referral_source: null,
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

// Shared by create() and autoCreateFromPayment() — both end up with a
// just-created client_packages row plus a set of its services that carry an
// optional `schedule`, and need to turn each into a real future appointment
// exactly the same way. An appointment's services[].service_id must
// reference a real catalog services row (commission calc, consumable
// recipes, and reports all join on it), so a service with no
// catalogServiceId (custom-named line / unresolvable at pick time) is
// reported as a scheduling error instead of booked with a nonsensical id.
// Package creation/sale itself has already committed by the time this runs —
// one failed auto-schedule must never undo it, hence Promise.allSettled and
// a returned error list instead of throwing.
async function scheduleServicesForPackage(params: {
  salonId: string;
  clientId: string;
  packageId: string;
  requesterUserId?: string;
  // Threaded through purely so the package_appointment_reminder_24h
  // scheduled row (below) can be created without a second DB round-trip —
  // the caller (create()/autoCreateFromPayment()) already has all of this.
  reminderContext?: { phone: string | null; countryCode: string | null; clientName: string; packageName: string; salonName: string };
  items: Array<{
    createdService: { serviceId: string; serviceName: string; catalogServiceId: string | null };
    schedule: { scheduledAt: string; staffId?: string; durationMinutes?: number };
  }>;
}): Promise<Array<{ serviceName: string; error: string }>> {
  const schedulingErrors: Array<{ serviceName: string; error: string }> = [];

  const uncatalogued = params.items.filter((x) => !x.createdService.catalogServiceId);
  for (const x of uncatalogued) {
    schedulingErrors.push({
      serviceName: x.createdService.serviceName,
      error: "This service isn't linked to a catalog service, so it can't be auto-scheduled — book it manually.",
    });
  }

  const schedulable = params.items.filter((x) => !!x.createdService.catalogServiceId);
  if (schedulable.length > 0) {
    const results = await Promise.allSettled(
      schedulable.map(async ({ createdService, schedule }) => {
        const appointment = await appointmentsService.create({
          requesterUserId: params.requesterUserId ?? "system",
          body: {
            salon_id:         params.salonId,
            client_id:        params.clientId,
            staff_id:         schedule.staffId,
            scheduled_at:     schedule.scheduledAt,
            duration_minutes: schedule.durationMinutes ?? 30,
            status:           "booked",
            services: [{
              service_id:                 createdService.catalogServiceId!,
              staff_id:                   schedule.staffId,
              name:                       createdService.serviceName,
              // Already paid for as part of the package total — this
              // appointment must never generate its own charge.
              price:                      0,
              quantity:                   1,
              is_package_service:         true,
              client_package_id:          params.packageId,
              client_package_service_id:  createdService.serviceId,
            }],
          },
        });
        await clientPackagesRepository.createServiceSchedule({
          clientPackageId:        params.packageId,
          clientPackageServiceId: createdService.serviceId,
          appointmentId:          appointment.id,
          staffId:                schedule.staffId ?? null,
          scheduledAt:            schedule.scheduledAt,
        });

        // ── Scheduled Templates: package_appointment_reminder_24h ──────────
        if (params.reminderContext?.phone) {
          await waScheduledMessagesService.scheduleAppointmentReminder({
            salonId: params.salonId, clientId: params.clientId,
            phone: params.reminderContext.phone, countryCode: params.reminderContext.countryCode,
            appointmentId: appointment.id, scheduledAt: schedule.scheduledAt,
            clientName: params.reminderContext.clientName, salonName: params.reminderContext.salonName,
            serviceName: createdService.serviceName,
            packageLinked: { packageName: params.reminderContext.packageName },
          }).catch((err: any) => logger.error("[wa-scheduled] package_appointment_reminder_24h schedule failed:", err?.message ?? err));
        }
      }),
    );
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        const name = schedulable[i].createdService.serviceName;
        const err  = result.reason as any;
        logger.error("[client-packages] auto-schedule failed", { packageId: params.packageId, serviceName: name, error: err?.message ?? err });
        schedulingErrors.push({ serviceName: name, error: err?.message ?? "Failed to schedule appointment" });
      }
    });
  }

  return schedulingErrors;
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

  async create(salonId: string, dto: CreateClientPackageDTO, requesterUserId?: string): Promise<ClientPackage> {
    const pkg = await clientPackagesRepository.create(salonId, dto);

    // Fetched once, reused below for both the package_appointment_reminder_24h
    // scheduling context and the package_purchased trigger's salon_name.
    const salon = pkg.mobile ? await salonsRepository.findById(salonId) : null;
    const reminderContext = pkg.mobile
      ? { phone: pkg.mobile, countryCode: null, clientName: pkg.clientName ?? "Valued Customer", packageName: pkg.packageName, salonName: salon?.business_name ?? "our salon" }
      : undefined;

    // ── Auto-schedule future appointments for services that carried a `schedule` ──
    // dto.services and pkg.services are index-aligned (repository.create()
    // reorders its result to guarantee this).
    const toSchedule = dto.services
      .map((svc, idx) => ({ svc, created: pkg.services[idx] }))
      .filter((x): x is { svc: typeof dto.services[number] & { schedule: NonNullable<typeof x.svc.schedule> }; created: typeof x.created } =>
        !!x.svc.schedule && !!x.created)
      .map((x) => ({ createdService: x.created, schedule: x.svc.schedule }));

    if (toSchedule.length > 0) {
      const schedulingErrors = await scheduleServicesForPackage({
        salonId, clientId: dto.clientId, packageId: pkg.id, requesterUserId, reminderContext, items: toSchedule,
      });
      if (schedulingErrors.length > 0) pkg.schedulingErrors = schedulingErrors;
    }

    // ── Scheduled Templates: package_expiring_7d / package_expiring_24h ────
    if (pkg.mobile && pkg.expiryDate) {
      waScheduledMessagesService.schedulePackageExpiry({
        salonId, clientId: dto.clientId, phone: pkg.mobile, countryCode: null,
        packageId: pkg.id, packageName: pkg.packageName, clientName: pkg.clientName ?? "Valued Customer",
        expiryDate: pkg.expiryDate,
        remainingSessions: pkg.services.reduce((sum, s) => sum + s.remainingSessions, 0),
      }).catch((err: any) => logger.error("[wa-scheduled] package expiry schedule failed:", err?.message ?? err));
    }

    // ── Auto-create sale record so package revenue appears in dashboard ────────
    // Captured outside the try block so the WhatsApp trigger below (Package
    // Purchased) can include the real invoice number without a second
    // round-trip — null if the sale record itself failed to create.
    let invoiceNumber: string | null = null;
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
      invoiceNumber = txn.sale.invoice_number;
    } catch (err) {
      logger.error('[clientPackagesService] Failed to auto-create sale for package purchase:', { error: err });
    }

    // ── WhatsApp Automation: Package Purchased ──────────────────────────────
    // mobile field on ClientPackage is the client's phone number
    if (pkg.mobile) {
      (async () => {
        whatsappAutomationService.trigger({
          salonId,
          eventType:     "package_purchased",
          clientId:      dto.clientId,
          phone:         pkg.mobile!,
          countryCode:   null,
          variables: {
            "1": pkg.clientName ?? "Valued Customer",
            "2": pkg.packageName,
            "3": pkg.services.map((s) => s.serviceName).join(", "),
            "4": String(pkg.services.reduce((sum, s) => sum + s.totalSessions, 0)),
            "5": pkg.expiryDate ?? "",
            "6": String((pkg.basePrice ?? 0) - (pkg.discount ?? 0)),
            "7": invoiceNumber ?? "—",
          },
          referenceId:   pkg.id,
          referenceType: "package",
          dedupeByReference: true,
        }).catch(() => {});
      })().catch(() => {});
    }

    // ── WhatsApp: PDF purchase receipt ─────────────────────────────────────
    // mobile field on ClientPackage is the client's phone number
    if (pkg.mobile) {
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
      logger.info(`[WA-AUTO] Skipping purchase receipt for package ${pkg.id} — no mobile number`)
    }

    return pkg;
  },

  async update(id: string, salonId: string, dto: UpdateClientPackageDTO): Promise<ClientPackage> {
    const pkg = await clientPackagesRepository.update(id, salonId, dto);
    if (!pkg) throw { statusCode: 404, message: "Client package not found" };
    // A direct expiry-date edit (outside the normal purchase/renewal flow)
    // must move its expiry reminders too, or they go stale — same reasoning
    // as the reschedule-on-appointment-move hook above.
    if (dto.expiryDate && pkg.mobile) {
      waScheduledMessagesService.schedulePackageExpiry({
        salonId, clientId: pkg.clientId, phone: pkg.mobile, countryCode: null,
        packageId: pkg.id, packageName: pkg.packageName, clientName: pkg.clientName ?? "Valued Customer",
        expiryDate: pkg.expiryDate,
        remainingSessions: pkg.services.reduce((sum, s) => sum + s.remainingSessions, 0),
      }).catch((err: any) => logger.error("[wa-scheduled] expiry reschedule-on-edit failed:", err?.message ?? err));
    }
    return pkg;
  },

  async delete(id: string, salonId: string): Promise<void> {
    const deleted = await clientPackagesRepository.delete(id, salonId);
    if (!deleted) throw { statusCode: 404, message: "Client package not found" };
    waScheduledMessagesService.cancelForReference('package', id)
      .catch((err: any) => logger.error("[wa-scheduled] cancel-on-delete failed:", err?.message ?? err));
  },

  async completeSession(
    packageId: string,
    salonId:   string,
    dto:       CompleteSessionDTO,
  ): Promise<ClientPackage> {
    const updated = await clientPackagesRepository.completeSession(packageId, salonId, dto);
    if (!updated) throw { statusCode: 404, message: "Client package not found" };

    // ── WhatsApp Automation: Package Session Used (every redemption) ───────
    if (updated.mobile) {
      (async () => {
        const salon = await salonsRepository.findById(salonId);
        const svc = updated.services.find((s) => s.serviceId === dto.serviceId);
        whatsappAutomationService.trigger({
          salonId,
          eventType:     "package_session_used",
          clientId:      updated.clientId,
          phone:         updated.mobile!,
          countryCode:   null,
          variables: {
            "1": updated.clientName ?? "Valued Customer",
            "2": svc?.serviceName ?? "your service",
            "3": updated.packageName,
            "4": String(svc?.remainingSessions ?? 0),
            "5": salon?.business_name ?? "our salon",
          },
          referenceId:   `${updated.id}:${dto.serviceId}:${(svc?.completedSessions ?? 0)}`,
          referenceType: "package",
          dedupeByReference: true,
        }).catch(() => {});
      })().catch(() => {});
    }

    return updated;
  },

  // ── Future-appointment linkage side effects (called from appointments.service.ts) ──
  // These four are the exact-match counterpart to the fuzzy, checkout-time
  // markPackageSessions() coverage-matching the frontend already does for
  // walk-in/Quick Sale package usage — that path is untouched; these only
  // fire for appointments auto-created by client-packages.service.ts::create().

  // Redeems the one session this appointment was booked for, but only if
  // it's still 'Scheduled' — a retried/duplicate checkout call on an
  // already-completed appointment is a silent no-op instead of burning a
  // second session for one real visit. No-op (not an error) when the
  // appointment isn't package-linked at all.
  async redeemForAppointmentIfScheduled(salonId: string, appointmentId: string, staffName: string): Promise<void> {
    const schedule = await clientPackagesRepository.findScheduleByAppointmentId(appointmentId);
    if (!schedule || schedule.status !== "Scheduled") return;
    await clientPackagesService.completeSession(schedule.clientPackageId, salonId, {
      serviceId: schedule.clientPackageServiceId,
      staffName,
      appointmentId,
    });
    await clientPackagesRepository.updateScheduleStatusByAppointmentId(appointmentId, "Completed");
    // The visit already happened — a "your appointment is tomorrow" reminder
    // scheduled for this appointment (if it hadn't fired yet) no longer makes sense.
    waScheduledMessagesService.cancelForReference('appointment', appointmentId, 'package_appointment_reminder_24h')
      .catch((err: any) => logger.error("[wa-scheduled] cancel-on-complete failed:", err?.message ?? err));
  },

  // Cancelling never deducts the session — the service becomes reschedulable
  // again (derived as "Not Scheduled" once its only schedule row is
  // Cancelled). Safe to call on any appointment id; a no-op if unlinked.
  async cancelScheduleForAppointment(appointmentId: string): Promise<void> {
    await clientPackagesRepository.updateScheduleStatusByAppointmentId(appointmentId, "Cancelled");
    waScheduledMessagesService.cancelForReference('appointment', appointmentId, 'package_appointment_reminder_24h')
      .catch((err: any) => logger.error("[wa-scheduled] cancel-on-cancel failed:", err?.message ?? err));
  },

  // Reschedule reuses the same schedule row/appointment — only the
  // denormalized scheduled_at copy moves. Safe to call on any appointment
  // id; a no-op if unlinked.
  async rescheduleForAppointment(appointmentId: string, scheduledAt: string): Promise<void> {
    await clientPackagesRepository.updateScheduleTimeByAppointmentId(appointmentId, scheduledAt);
    const reminderAt = new Date(new Date(scheduledAt).getTime() - 24 * 3600_000);
    waScheduledMessagesService.rescheduleForReference('appointment', appointmentId, 'package_appointment_reminder_24h', reminderAt)
      .catch((err: any) => logger.error("[wa-scheduled] reschedule-on-move failed:", err?.message ?? err));
  },

  // No-show follows the salon's configured policy (default: do not deduct,
  // same reschedulable end state as cancel) — see package-settings.util.ts.
  async handleNoShowForAppointment(salonId: string, appointmentId: string): Promise<void> {
    const schedule = await clientPackagesRepository.findScheduleByAppointmentId(appointmentId);
    if (!schedule || schedule.status !== "Scheduled") return;

    const policy = await getPackageNoShowPolicy(salonId);
    if (policy === "deduct_package") {
      await clientPackagesService.completeSession(schedule.clientPackageId, salonId, {
        serviceId: schedule.clientPackageServiceId,
        staffName: "No-show (auto)",
        appointmentId,
      });
      await clientPackagesRepository.updateScheduleStatusByAppointmentId(appointmentId, "Completed");
    } else {
      await clientPackagesRepository.updateScheduleStatusByAppointmentId(appointmentId, "No Show");
    }
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
    services:     Array<{
      serviceId?: string; serviceName: string; totalSessions: number; price: number;
      // Set only when the frontend already resolved this service's
      // schedule-at-purchase (Quick Sale's "+ Package" row — see
      // ServicesPanel.tsx's PackageRow) — mirrors CreateClientPackageDTO's
      // per-service schedule on the standalone Sell Package form.
      schedule?: { scheduledAt: string; staffId?: string; durationMinutes?: number };
    }>,
    basePrice:    number,
    discount:     number,
    gstPercentage: number,
    expiryDate:   string,
    // Copied from the resolved template's own expireAfterServices, when one
    // was found (see payments.service.ts's template lookup) — undefined/null
    // for custom/combo packages, which have no template to carry this from.
    expireAfterServices: number | null | undefined,
    // Copied from the resolved template/combo's own description, same
    // resolution point as expireAfterServices above.
    description: string | null | undefined,
    appointmentId?: string,
    // Staff on the checkout appointment, and the sales row the checkout's own
    // recordTransaction() call already created for this bill — passed through
    // so the Package Sale report can show Staff/Invoice No for packages sold
    // as a line item on a bill, not just via the standalone Create Package form.
    staffId?:     string,
    saleId?:      string,
    requesterUserId?: string,
    // Share of the bill collected so far (0..1), applied to this package's own
    // total. Defaults to fully paid — every caller before packages became
    // creditable on a partially-paid bill. See the idempotency block below:
    // this same function runs again when the balance is later settled.
    paidFraction: number = 1,
    isFullyPaid:  boolean = true,
  ): Promise<void> {
    logger.info(`[client-packages/auto-create] salon=${salonId} client=${clientId} name="${packageName}" services=${services.length} price=${basePrice}`);
    try {
      // A package is credited as soon as its bill is partially paid, so this
      // runs a second time on the payment that clears the balance. Without
      // this guard that second run would insert a duplicate package (there is
      // no unique constraint covering it) — instead, settle the existing row
      // and stop. Also covers any other repeat payment call on the same bill.
      if (appointmentId) {
        const existingId = await clientPackagesRepository.findIdByAppointmentAndName(
          salonId, appointmentId, packageName,
        );
        if (existingId) {
          // Every later payment on the same bill re-states this row's
          // paid/pending — an instalment in the middle keeps it accurate, and
          // the one that clears the balance settles it to Paid.
          await clientPackagesRepository.updatePaymentProgress(
            existingId, salonId, isFullyPaid ? 1 : paidFraction,
          );
          return;
        }
      }

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
        expireAfterServices: expireAfterServices ?? null,
        description: description ?? null,
        basePrice,
        gstPercentage,
        discount,
        paymentMethod,
        services,
        appointmentId,
        staffId,
        ...(isFullyPaid ? {} : { paidFraction, paymentStatus: "Partial" as const }),
      });

      if (saleId) {
        await clientPackagesRepository.setSaleId(created.id, salonId, saleId);
      }
      // Logged here, not after the scheduling/WhatsApp work below: by this
      // point the client_packages row exists and is queryable, which is the
      // only part the caller waits on.
      logger.info(`[client-packages/auto-create] SUCCESS — client=${clientId}, package=${packageName}`);

      // ── Everything past this point is deliberately NOT awaited ────────────
      // Booking the scheduled appointments took ~7s in practice (it creates a
      // real appointment per service, each with its own notification/WhatsApp
      // fan-out). Awaiting it inside the caller's request would push the
      // checkout response out by that much; leaving the WHOLE function
      // detached instead meant the payment returned before the package row
      // existed, so the UI's immediate post-checkout refetch of
      // /client-packages came back empty and the client appeared to have no
      // package. Splitting it is what satisfies both: the row is committed
      // before the caller returns, the slow fan-out continues in background.
      void (async () => {
        try {
          // Auto-schedule any services that carried a schedule-at-purchase —
          // same mechanism create() uses for the standalone Sell Package form.
          // created.services is index-aligned with `services`
          // (repository.create() guarantees this). Logged only — this checkout
          // has already fully succeeded (payment collected, package created),
          // so a scheduling failure must never surface as a payment error.
          // Fetched once, reused for both the appointment-reminder scheduling
          // context below and (unlike create()'s salon lookup) not needed by
          // the package_purchased trigger, which carries no salon_name variable.
          const salon = created.mobile ? await salonsRepository.findById(salonId) : null;
          const reminderContext = created.mobile
            ? { phone: created.mobile, countryCode: null, clientName: created.clientName ?? "Valued Customer", packageName: created.packageName, salonName: salon?.business_name ?? "our salon" }
            : undefined;

          const toSchedule = services
            .map((svc, idx) => ({ svc, created: created.services[idx] }))
            .filter((x): x is { svc: typeof services[number] & { schedule: NonNullable<typeof x.svc.schedule> }; created: typeof x.created } =>
              !!x.svc.schedule && !!x.created)
            .map((x) => ({ createdService: x.created, schedule: x.svc.schedule }));
          if (toSchedule.length > 0) {
            const schedulingErrors = await scheduleServicesForPackage({
              salonId, clientId, packageId: created.id, requesterUserId, reminderContext, items: toSchedule,
            });
            if (schedulingErrors.length > 0) {
              logger.warn('[client-packages/auto-create] scheduling errors', { packageId: created.id, schedulingErrors });
            }
          }

          // ── Scheduled Templates: package_expiring_7d / package_expiring_24h ──
          // Unconditional (unlike package_purchased below) — a Calendar-sold
          // package still has an expiry date that needs its own reminder,
          // independent of which notification covered the purchase itself.
          if (created.mobile && expiryDate) {
            await waScheduledMessagesService.schedulePackageExpiry({
              salonId, clientId, phone: created.mobile, countryCode: null,
              packageId: created.id, packageName: created.packageName, clientName: created.clientName ?? "Valued Customer",
              expiryDate,
              remainingSessions: created.services.reduce((sum, s) => sum + s.remainingSessions, 0),
            }).catch((err: any) => logger.error("[wa-scheduled] package expiry schedule failed:", err?.message ?? err));
          }

          // ── WhatsApp Automation: Package Purchased ───────────────────────
          // Only when NOT sold within a Calendar/appointment checkout — that
          // checkout's own single payment_received message already covers it,
          // so this itemized confirmation stays Quick-Sale/standalone only.
          if (!appointmentId && created.mobile) {
            const invoiceNumber = saleId
              ? await clientPackagesRepository.getSaleInvoiceNumber(saleId, salonId)
              : null;
            whatsappAutomationService.trigger({
              salonId,
              eventType:     "package_purchased",
              clientId,
              phone:         created.mobile,
              countryCode:   null,
              variables: {
                "1": created.clientName ?? "Valued Customer",
                "2": created.packageName,
                "3": created.services.map((s) => s.serviceName).join(", "),
                "4": String(services.reduce((sum, s) => sum + s.totalSessions, 0)),
                "5": expiryDate,
                "6": String(basePrice - discount),
                "7": invoiceNumber ?? "—",
              },
              referenceId:   created.id,
              referenceType: "package",
              dedupeByReference: true,
            }).catch(() => {});
          }

        } catch (err: any) {
          logger.warn('[client-packages/auto-create] post-create work failed:', err?.message ?? err);
        }
      })();
    } catch (err: any) {
      logger.warn('[client-packages/auto-create] FAILED:', err?.message ?? err);
    }
  },
};
