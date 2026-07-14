import ExcelJS from "exceljs";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { appointmentsRepository } from "./appointments.repository";
import { salesRepository } from "../sales/sales.repository";
import { productsRepository } from "../products/products.repository";
import { commissionCalculationService } from "../commission/commissionCalculation.service";
import { blockedTimesRepository } from "../blocked_times/blocked_times.repository";
import { salesService } from "../sales/sales.service";
import { whatsappAutomationService } from "../whatsapp-automation/whatsapp-automation.service";
import { whatsappAutomationRepository } from "../whatsapp-automation/whatsapp-automation.repository";
import { attendanceService } from "../attendance/attendance.service";
import { notificationsService } from "../notifications/notifications.service";
import { emailService } from "../utils/email.service";
import { canSendEmail } from "../utils/notif-prefs";
import { salonsRepository } from "../salons/salons.repository";
import { branchesRepository } from "../branches/branches.repository";
import { staffService } from "../staff/staff.service";
import { clientsRepository } from "../clients/clients.repository";
import { sendReceiptDocument } from "../sales/receipt-whatsapp.service";
import { sendPurchaseReceipt } from "../sales/receipt-send.helper";
import { notifyAppointmentCompleted } from "./appointment-completed.helper";
import {
    Appointment,
    CreateAppointmentBody,
    UpdateAppointmentBody,
    CancelAppointmentBody,
} from "./appointments.types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit", month: "short", year: "numeric",
    });
}

function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit", minute: "2-digit", hour12: true,
    });
}

// ── Service ───────────────────────────────────────────────────────────────────

export const appointmentsService = {

    async create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateAppointmentBody;
    }): Promise<Appointment> {
        const { requesterUserId, body } = params;

        if (body.staff_id && body.staff_id.trim().length > 0) {
            // Overlapping appointments for the same staff are allowed (e.g. hair color
            // processing time) — the receptionist books intentionally, not by mistake.
            const apptDate = new Date(body.scheduled_at);
            const dateStr  = apptDate.toISOString().slice(0, 10);
            const pad = (n: number) => String(n).padStart(2, "0");
            const startStr = `${pad(apptDate.getUTCHours())}:${pad(apptDate.getUTCMinutes())}`;
            const endMs    = apptDate.getTime() + body.duration_minutes * 60_000;
            const endDate  = new Date(endMs);
            const endStr   = `${pad(endDate.getUTCHours())}:${pad(endDate.getUTCMinutes())}`;

            const blocked = await blockedTimesRepository.hasOverlap({
                staffId: body.staff_id,
                date: dateStr,
                startTime: startStr,
                endTime: endStr,
            });
            if (blocked) {
                throw new AppError(409, "This time slot is blocked for the selected staff.", "BLOCKED_TIME");
            }
        }

        if (!body.service_id && body.services && body.services.length > 0) {
            body.service_id = body.services[0].service_id;
        }

        if (!body.staff_id && body.services && body.services.length > 0 && body.services[0].staff_id) {
            body.staff_id = body.services[0].staff_id ?? undefined;
        }

        const appointment = await appointmentsRepository.create(body, requesterUserId);
        logger.info("appointmentsService.create success", { appointmentId: appointment.id });

        // Deduct stock for products sold in this appointment (fire-and-forget)
        const soldProducts = (body.product_items ?? []).filter(p => p.product_id);
        if (soldProducts.length > 0) {
            productsRepository.deductStock(
                soldProducts.map(p => ({ product_id: p.product_id!, quantity: p.quantity })),
                body.salon_id
            ).catch(err => logger.warn("Stock deduction failed (non-fatal)", { err: err?.message }));
        }

        // Fire notification (fire-and-forget)
        notificationsService.create({
            salon_id: appointment.salon_id,
            type:     "appointment",
            title:    "New Appointment Booked",
            body:     `${appointment.client_name ?? "Walk-in"} — ${formatDate(appointment.scheduled_at)} at ${formatTime(appointment.scheduled_at)}`,
        }).catch(() => {});

        // ── WhatsApp Automation: Appointment Confirmation ─────────────────────
        // Dedup check — NEVER send confirmation twice for the same appointment
        if (appointment.client_id) {
            try {
                const full = await appointmentsRepository.findById(appointment.id);
                if (full && (full as any).client_phone) {
                    const alreadySent = await whatsappAutomationRepository.logExistsForReference(
                        full.id,
                        "appointment_confirmation"
                    );
                    if (!alreadySent) {
                        whatsappAutomationService.trigger({
                            salonId:       full.salon_id,
                            eventType:     "appointment_confirmation",
                            clientId:      full.client_id,
                            phone:         (full as any).client_phone,
                            countryCode:   (full as any).client_phone_code ?? null,
                            variables: {
                                "1": full.client_name                      ?? "Valued Customer",
                                "2": (full as any).salon_name              ?? "our salon",
                                "3": full.services?.[0]?.name ?? full.title ?? "your service",
                                "4": formatDate(full.scheduled_at),
                                "5": formatTime(full.scheduled_at),
                            },
                            referenceId:   full.id,
                            referenceType: "appointment",
                        }).catch(() => {});
                    }
                }
            } catch (_) {
                // Never block core flow
            }
        }

        // ── Email: New Appointment (to salon owner) ───────────────────────────
        ;(async () => {
            try {
                const full = await appointmentsRepository.findById(appointment.id);
                if (!full) return;
                const ownerEmail = await salonsRepository.findOwnerEmailById(full.salon_id);
                if (!ownerEmail) return;
                const allowed = await canSendEmail(full.salon_id, "newAppointment");
                if (!allowed) return;
                await emailService.sendNewAppointmentEmail({
                    to:            ownerEmail,
                    salonName:     (full as any).salon_name  ?? "your salon",
                    clientName:    full.client_name          ?? "Walk-in",
                    services:      full.services?.map((s: any) => s.name).join(", ") ?? "Service",
                    date:          formatDate(full.scheduled_at),
                    time:          formatTime(full.scheduled_at),
                    appointmentId: full.id,
                });
            } catch (err: any) { logger.error("[email] newAppointment failed:", err?.message ?? err); }
        })();

        return appointment;
    },

    async getById(id: string): Promise<Appointment> {
        const appointment = await appointmentsRepository.findById(id);
        if (!appointment) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        return appointment;
    },

    async list(params: {
        salonId?: string;
        clientId?: string;
        date?: string;
        staffId?: string;
        status?: string;
        startDate?: string;
        endDate?: string;
        page?: number;
        limit?: number;
    }): Promise<{ data: Appointment[]; totalRecords: number; totalPages: number; currentPage: number } | Appointment[]> {
        const { salonId, clientId, date, staffId, status, startDate, endDate, page, limit } = params;
        if (clientId) return appointmentsRepository.listByClientId(clientId);
        if (!salonId) throw new AppError(400, "salon_id or client_id is required", "VALIDATION_ERROR");
        return appointmentsRepository.listBySalonId(salonId, {
            date, staff_id: staffId, status,
            start_date: startDate, end_date: endDate,
            page, limit,
        });
    },

    async update(params: {
        appointmentId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateAppointmentBody;
    }): Promise<Appointment> {
        const { appointmentId, patch } = params;
        const existing = await appointmentsRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");

        if (["completed", "cancelled", "no_show"].includes(existing.status))
            throw new AppError(400, `Cannot update an appointment with status '${existing.status}'`, "BAD_REQUEST");

        // Overlapping appointments for the same staff are allowed (e.g. hair color
        // processing time) — no conflict check on reschedule/staff/duration changes.

        const updated = await appointmentsRepository.update(appointmentId, patch);

        // Adjust stock when product_items list changes (fire-and-forget)
        if (patch.product_items !== undefined) {
            const oldItems = (existing.product_items ?? []).filter(p => p.product_id);
            const newItems = (patch.product_items ?? []).filter(p => p.product_id);

            const oldMap = new Map(oldItems.map(p => [p.product_id!, p.quantity]));
            const newMap = new Map(newItems.map(p => [p.product_id!, p.quantity]));

            const toDeduct: { product_id: string; quantity: number }[] = [];
            const toRestore: { product_id: string; quantity: number }[] = [];

            for (const [id, newQty] of newMap) {
                const oldQty = oldMap.get(id) ?? 0;
                if (newQty > oldQty) toDeduct.push({ product_id: id, quantity: newQty - oldQty });
                else if (newQty < oldQty) toRestore.push({ product_id: id, quantity: oldQty - newQty });
            }
            for (const [id, oldQty] of oldMap) {
                if (!newMap.has(id)) toRestore.push({ product_id: id, quantity: oldQty });
            }

            if (toDeduct.length > 0)
                productsRepository.deductStock(toDeduct, existing.salon_id).catch(err => logger.warn("Stock deduction failed (non-fatal)", { err: err?.message }));
            if (toRestore.length > 0)
                productsRepository.restoreStock(toRestore, existing.salon_id).catch(err => logger.warn("Stock restore failed (non-fatal)", { err: err?.message }));
        }

        // ── Live calendar update ───────────────────────────────────────────────
        // create()/cancel() already push a "notification" socket event that the
        // calendar listens to for a live refresh — update() (reschedule, staff
        // reassignment, or LUNOX's modifyAppointmentServices changing what's
        // booked/its duration) never did, so any of these silently required a
        // manual page refresh to appear correctly.
        if (patch.scheduled_at || patch.staff_id || patch.services || patch.duration_minutes) {
            notificationsService.create({
                salon_id: existing.salon_id,
                type:     "appointment",
                title:    "Appointment Updated",
                body:     `${existing.client_name ?? "Walk-in"} — ${formatDate(updated.scheduled_at)} at ${formatTime(updated.scheduled_at)}`,
            }).catch(() => {});
        }

        // ── WhatsApp Automation: Appointment Rescheduled ──────────────────────
        // Only fire if scheduled_at actually changed
        if (patch.scheduled_at && existing.client_id) {
            try {
                const full = await appointmentsRepository.findById(appointmentId);
                if (full && (full as any).client_phone) {
                    const alreadySent = await whatsappAutomationRepository.logExistsForReference(
                        full.id,
                        'appointment_rescheduled'
                    )
                    if (!alreadySent) {
                        whatsappAutomationService.trigger({
                            salonId:       full.salon_id,
                            eventType:     "appointment_rescheduled",
                            clientId:      full.client_id,
                            phone:         (full as any).client_phone,
                            countryCode:   (full as any).client_phone_code ?? null,
                            variables: {
                                "1": full.client_name         ?? "Valued Customer",
                                "2": (full as any).salon_name ?? "our salon",
                                "3": formatDate(full.scheduled_at),
                                "4": formatTime(full.scheduled_at),
                            },
                            referenceId:   full.id,
                            referenceType: "appointment",
                        }).catch(() => {});
                    }
                }
            } catch (_) {
                // Never block core flow
            }
        }

        return updated;
    },

    async confirm(appointmentId: string): Promise<Appointment> {
        const existing = await appointmentsRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (existing.status !== "booked")
            throw new AppError(400, "Only booked appointments can be confirmed", "BAD_REQUEST");
        return appointmentsRepository.updateStatus(appointmentId, "confirmed");
    },

    async start(appointmentId: string): Promise<Appointment> {
        const existing = await appointmentsRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (!["booked", "confirmed"].includes(existing.status))
            throw new AppError(400, "Appointment must be booked or confirmed to start", "BAD_REQUEST");
        return appointmentsRepository.updateStatus(appointmentId, "in_progress");
    },

    async serviceCheckIn(appointmentId: string, startedAt?: string): Promise<Appointment> {
        const existing = await appointmentsRepository.findById(appointmentId);
        if (!existing || existing.deleted_at) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (["cancelled", "no_show"].includes(existing.status))
            throw new AppError(400, `Cannot check in a '${existing.status}' appointment`, "BAD_REQUEST");
        if (startedAt && isNaN(new Date(startedAt).getTime()))
            throw new AppError(400, "Invalid started_at timestamp", "BAD_REQUEST");
        const updated = await appointmentsRepository.serviceCheckIn(appointmentId, startedAt);
        if (!updated) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        return updated;
    },

    async serviceCheckOut(appointmentId: string, endedAt?: string): Promise<Appointment> {
        const existing = await appointmentsRepository.findById(appointmentId);
        if (!existing || existing.deleted_at) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (!existing.service_started_at)
            throw new AppError(400, "Appointment must be checked in before it can be checked out", "BAD_REQUEST");
        if (endedAt && isNaN(new Date(endedAt).getTime()))
            throw new AppError(400, "Invalid ended_at timestamp", "BAD_REQUEST");
        const updated = await appointmentsRepository.serviceCheckOut(appointmentId, endedAt);
        if (!updated) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        return updated;
    },

    async cancel(params: {
        appointmentId: string;
        requesterUserId: string;
        body: CancelAppointmentBody;
    }): Promise<Appointment> {
        const existing = await appointmentsRepository.findById(params.appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (["completed", "cancelled"].includes(existing.status))
            throw new AppError(400, `Appointment is already '${existing.status}'`, "BAD_REQUEST");

        const cancelled = await appointmentsRepository.updateStatus(params.appointmentId, "cancelled");

        // Restore stock for cancelled appointment products (fire-and-forget)
        const cancelledProducts = (existing.product_items ?? []).filter(p => p.product_id);
        if (cancelledProducts.length > 0) {
            productsRepository.restoreStock(
                cancelledProducts.map(p => ({ product_id: p.product_id!, quantity: p.quantity })),
                existing.salon_id
            ).catch(err => logger.warn("Stock restore failed (non-fatal)", { err: err?.message }));
        }

        // ── Push Notification: Appointment Cancelled (to salon owner) ─────────
        notificationsService.create({
            salon_id: existing.salon_id,
            type:     "appointment",
            title:    "Appointment Cancelled",
            body:     `${existing.client_name ?? "Walk-in"} — ${formatDate(existing.scheduled_at)} at ${formatTime(existing.scheduled_at)}`,
        }).catch(() => {});

        // ── WhatsApp Automation: Appointment Cancelled ────────────────────────
        if (existing.client_id && (existing as any).client_phone) {
            whatsappAutomationService.trigger({
                salonId:       existing.salon_id,
                eventType:     "appointment_cancelled",
                clientId:      existing.client_id,
                phone:         (existing as any).client_phone,
                countryCode:   (existing as any).client_phone_code ?? null,
                variables: {
                    "1": existing.client_name         ?? "Valued Customer",
                    "2": (existing as any).salon_name ?? "our salon",
                    "3": formatDate(existing.scheduled_at),
                    "4": formatTime(existing.scheduled_at),
                },
                referenceId:   existing.id,
                referenceType: "appointment",
            }).catch(() => {});
        }

        // ── Email: Appointment Cancelled (to salon owner) ────────────────────
        ;(async () => {
            try {
                const ownerEmail = await salonsRepository.findOwnerEmailById(existing.salon_id);
                if (!ownerEmail) { logger.warn("[email] appointmentCancelled (owner): no owner email, skipping"); return; }
                logger.info(`[email] appointmentCancelled (owner) → to=${ownerEmail}`);
                const allowed = await canSendEmail(existing.salon_id, "appointmentCancelled");
                if (!allowed) { logger.info("[email] appointmentCancelled (owner): skipped (preference off)"); return; }
                await emailService.sendAppointmentCancelledOwnerEmail({
                    to:            ownerEmail,
                    salonName:     (existing as any).salon_name ?? "your salon",
                    clientName:    existing.client_name         ?? "Walk-in",
                    date:          formatDate(existing.scheduled_at),
                    time:          formatTime(existing.scheduled_at),
                    appointmentId: existing.id,
                });
                logger.info(`[email] appointmentCancelled (owner) sent to ${ownerEmail}`);
            } catch (err: any) { logger.error("[email] appointmentCancelled (owner) failed:", err?.message ?? err); }
        })();

        // ── Email: Appointment Cancelled (to client) ──────────────────────────
        ;(async () => {
            try {
                const clientEmail = (existing as any).client_email;
                if (!clientEmail) { logger.info("[email] appointmentCancelled: no client email, skipping"); return; }
                logger.info(`[email] appointmentCancelled → to=${clientEmail}`);
                const allowed = await canSendEmail(existing.salon_id, "appointmentCancelled");
                if (!allowed) { logger.info("[email] appointmentCancelled: skipped (preference off)"); return; }
                await emailService.sendAppointmentCancelledEmail({
                    to:         clientEmail,
                    clientName: existing.client_name          ?? "Valued Customer",
                    salonName:  (existing as any).salon_name  ?? "our salon",
                    date:       formatDate(existing.scheduled_at),
                    time:       formatTime(existing.scheduled_at),
                });
                logger.info(`[email] appointmentCancelled sent to ${clientEmail}`);
            } catch (err: any) { logger.error("[email] appointmentCancelled failed:", err?.message ?? err); }
        })();

        return cancelled;
    },

    async delete(appointmentId: string): Promise<Appointment> {
        const existing = await appointmentsRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        const deleted = await appointmentsRepository.deleteById(appointmentId);
        if (!deleted) throw new AppError(500, "Failed to delete appointment", "INTERNAL_ERROR");
        logger.info("appointmentsService.delete success", { appointmentId });

        // Restore stock for deleted appointment products (fire-and-forget)
        const deletedProducts = (existing.product_items ?? []).filter(p => p.product_id);
        if (deletedProducts.length > 0) {
            productsRepository.restoreStock(
                deletedProducts.map(p => ({ product_id: p.product_id!, quantity: p.quantity })),
                existing.salon_id
            ).catch(err => logger.warn("Stock restore failed (non-fatal)", { err: err?.message }));
        }

        return deleted;
    },

    async noShow(appointmentId: string): Promise<Appointment> {
        const existing = await appointmentsRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (!["booked", "confirmed"].includes(existing.status))
            throw new AppError(400, "Only booked/confirmed appointments can be marked no-show", "BAD_REQUEST");
        return appointmentsRepository.updateStatus(appointmentId, "no_show");
    },

    async checkout(params: {
        appointmentId: string;
        requesterUserId: string;
        requesterRole?: string;
        saleItems: any[];
        discount_amount?: number;
        tip_amount?: number;
        tax_amount?: number;
        payment_method?: string;
        notes?: string;
    }): Promise<{ appointment: Appointment; saleId: string }> {
        const { appointmentId, requesterUserId, requesterRole, saleItems, ...saleExtras } = params;
        const existing = await appointmentsRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");

        if (existing.status === "completed")
            throw new AppError(400, "Appointment is already completed", "BAD_REQUEST");
        if (existing.status === "cancelled")
            throw new AppError(400, "Cannot checkout a cancelled appointment", "BAD_REQUEST");

        // ── Check if payments service already auto-created a sale for this appointment ─
        // This happens when POST /api/v1/payments runs before checkout.
        // In that case: use the existing sale, fire commission on it, mark appointment completed.
        const preExistingSale = await salesRepository.findByAppointmentId(appointmentId);
        if (preExistingSale) {
            logger.info("appointmentsService.checkout: using pre-existing sale from payments", {
                appointmentId, saleId: preExistingSale.id,
            });

            // Link sale to appointment if not already linked
            if (!existing.sale_id) {
                await appointmentsRepository.linkSale(appointmentId, preExistingSale.id);
            }

            // Fire commission on the existing sale items (fire-and-forget)
            const saleItems = await salesRepository.findItemsBySaleId(preExistingSale.id);
            commissionCalculationService.calculateForSale({
                salonId:         existing.salon_id,
                saleId:          preExistingSale.id,
                appointmentId,
                fallbackStaffId: existing.staff_id ?? null,
                items:           saleItems,
                packageItemIds:  new Set((existing.package_items ?? []).map(p => p.package_id)),
            }).catch(() => {});

            // Auto-mark attendance (fire-and-forget)
            if (existing.staff_id) {
                attendanceService.autoMarkFromAppointment({
                    salonId:         existing.salon_id,
                    staffId:         existing.staff_id,
                    scheduledAt:     existing.scheduled_at,
                    durationMinutes: existing.duration_minutes,
                }).catch(() => {});
            }

            // Mark appointment as completed
            const completedAppt = await appointmentsRepository.updateStatus(appointmentId, "completed");

            // ── WhatsApp Automation: Thank You + Review Request (fire-and-forget) ──
            notifyAppointmentCompleted(appointmentId).catch(() => {});

            // ── WhatsApp Automation: Purchase confirmation + PDF receipt (fallback) ──
            // payments.service.ts already fires this at payment-creation time when it
            // auto-creates the sale — this is a dedup-guarded safety net for when that
            // didn't happen (e.g. no client phone on file yet at payment time), so
            // completing the appointment doesn't silently leave the customer with only
            // the plain booking confirmation and no purchase text/PDF.
            if (existing.client_id && (existing as any).client_phone) {
                (async () => {
                    try {
                        const alreadySent =
                            (await whatsappAutomationRepository.logExistsForReference(preExistingSale.id, "service_purchased")) ||
                            (await whatsappAutomationRepository.logExistsForReference(preExistingSale.id, "product_purchased"));
                        if (alreadySent) return;

                        const presentTypes = new Set(saleItems.map((i) => i.item_type));
                        const purchaseEvents: Array<{ eventType: "service_purchased" | "product_purchased"; itemType: "service" | "product" }> = [
                            { eventType: "service_purchased", itemType: "service" },
                            { eventType: "product_purchased", itemType: "product" },
                        ];
                        for (const { eventType, itemType } of purchaseEvents) {
                            if (!presentTypes.has(itemType)) continue;
                            const itemName = saleItems.find((i) => i.item_type === itemType)?.name ?? "your purchase";
                            whatsappAutomationService.trigger({
                                salonId:       existing.salon_id,
                                eventType,
                                clientId:      existing.client_id!,
                                phone:         (existing as any).client_phone,
                                countryCode:   (existing as any).client_phone_code ?? null,
                                variables: {
                                    "1": existing.client_name         ?? "Valued Customer",
                                    "2": (existing as any).salon_name ?? "our salon",
                                    "3": itemName,
                                },
                                referenceId:   preExistingSale.id,
                                referenceType: "invoice",
                            }).catch(() => {});
                        }

                        await sendPurchaseReceipt({
                            salonId:     existing.salon_id,
                            phone:       (existing as any).client_phone,
                            countryCode: (existing as any).client_phone_code ?? null,
                            clientId:    existing.client_id,
                            clientName:  existing.client_name ?? "Valued Customer",
                            sale:        preExistingSale,
                            items:       saleItems,
                            appointment: {
                                id:              existing.id,
                                scheduledAt:     existing.scheduled_at,
                                durationMinutes: existing.duration_minutes,
                                status:          "completed",
                                notes:           existing.notes,
                            },
                            paidAmount:  Number(preExistingSale.total_amount ?? 0),
                            dueAmount:   0,
                            couponCode:  null,
                        });
                    } catch (err: any) {
                        logger.error("[WA-AUTO] preExistingSale purchase-confirmation fallback failed:", err?.message);
                    }
                })();
            }

            // ── Email: Appointment Completed receipt (to client) ──────────────
            ;(async () => {
                try {
                    const clientEmail = (existing as any).client_email;
                    if (!clientEmail) return;
                    const allowed = await canSendEmail(existing.salon_id, "appointmentCompleted");
                    if (!allowed) return;
                    await emailService.sendAppointmentCompletedEmail({
                        to:         clientEmail,
                        clientName: existing.client_name         ?? "Valued Customer",
                        salonName:  (existing as any).salon_name ?? "our salon",
                        services:   existing.services?.map((s: any) => s.name).join(", ") ?? "Service",
                        amount:     String(preExistingSale.total_amount ?? "0"),
                    });
                } catch (err: any) { logger.error("[email] appointmentCompleted (preexisting) failed:", err?.message ?? err); }
            })();

            // ── Email: New Payment (to salon owner) ───────────────────────────
            ;(async () => {
                try {
                    const ownerEmail = await salonsRepository.findOwnerEmailById(existing.salon_id);
                    if (!ownerEmail) return;
                    const allowed = await canSendEmail(existing.salon_id, "newPayment");
                    if (!allowed) return;
                    await emailService.sendNewPaymentEmail({
                        to:            ownerEmail,
                        salonName:     (existing as any).salon_name ?? "your salon",
                        clientName:    existing.client_name         ?? "Walk-in",
                        amount:        String(preExistingSale.total_amount ?? "0"),
                        paymentMethod: params.payment_method        ?? "N/A",
                        invoiceId:     preExistingSale.id.slice(0, 8).toUpperCase(),
                    });
                } catch (err: any) { logger.error("[email] newPayment (preexisting) failed:", err?.message ?? err); }
            })();

            return { appointment: completedAppt, saleId: preExistingSale.id };
        }

        // No pre-existing sale — standard flow
        if (existing.sale_id)
            throw new AppError(400, "Appointment already has a linked sale", "BAD_REQUEST");

        const resolvedItems = (saleItems && saleItems.length > 0)
            ? saleItems
            : [
                ...existing.services.map(s => ({
                    item_type: "service",
                    item_id: s.service_id,
                    staff_id: s.staff_id ?? undefined,
                    name: s.name,
                    quantity: s.quantity,
                    unit_price: s.price,
                })),
                ...existing.package_items.map(p => ({
                    item_type: "service",
                    item_id: p.package_id,
                    staff_id: p.staff_id ?? undefined,
                    name: p.name,
                    quantity: p.quantity,
                    unit_price: p.price,
                })),
                ...existing.product_items.map(pr => ({
                    item_type: "product",
                    item_id: pr.product_id ?? undefined,
                    staff_id: pr.staff_id ?? undefined,
                    name: pr.name,
                    quantity: pr.quantity,
                    unit_price: pr.price,
                })),
                ...existing.membership_items.map(m => ({
                    item_type: "membership",
                    item_id: m.membership_id ?? undefined,
                    staff_id: m.staff_id ?? undefined,
                    name: m.name,
                    quantity: m.quantity,
                    unit_price: m.price,
                })),
            ];

        const { sale, items } = await salesService.create({
            requesterUserId,
            requesterRole,
            body: {
                salon_id:       existing.salon_id,
                client_id:      existing.client_id  ?? undefined,
                appointment_id: appointmentId,
                staff_id:       existing.staff_id   ?? undefined,
                status:         "draft",
                items:          resolvedItems,
                ...saleExtras,
            } as any,
        });

        const appointment = await appointmentsRepository.linkSale(appointmentId, sale.id);

        // ── Fire commission on the new sale items (fire-and-forget) ──────────
        commissionCalculationService.calculateForSale({
            salonId:         existing.salon_id,
            saleId:          sale.id,
            appointmentId,
            fallbackStaffId: existing.staff_id ?? null,
            items,
            packageItemIds:  new Set((existing.package_items ?? []).map(p => p.package_id)),
        }).catch(() => {});

        // ── Auto-mark attendance for the staff member (fire-and-forget) ───────
        if (existing.staff_id) {
            attendanceService.autoMarkFromAppointment({
                salonId:         existing.salon_id,
                staffId:         existing.staff_id,
                scheduledAt:     existing.scheduled_at,
                durationMinutes: existing.duration_minutes,
            }).catch(() => {});
        }

        // ── WhatsApp Automation: Payment Received ─────────────────────────────
        if (existing.client_id && (existing as any).client_phone) {
            whatsappAutomationService.trigger({
                salonId:       existing.salon_id,
                eventType:     'payment_received',
                clientId:      existing.client_id,
                phone:         (existing as any).client_phone,
                countryCode:   (existing as any).client_phone_code ?? null,
                variables: {
                    '1': existing.client_name         ?? 'Valued Customer',
                    '2': String(sale.total_amount     ?? '0'),
                    '3': sale.id.slice(0, 8).toUpperCase(),
                },
                referenceId:   sale.id,
                referenceType: 'invoice',
            }).catch(() => {});

            // PDF receipt as a WhatsApp document attachment — best-effort, only
            // deliverable within 24h of the customer's last message. Failure here
            // is expected outside that window and never blocks the text confirmation above.
            (async () => {
                const [salonRecord, branches, staffList, clientRecord] = await Promise.all([
                    salonsRepository.findById(existing.salon_id),
                    branchesRepository.listBySalonId(existing.salon_id),
                    staffService.list(existing.salon_id, { is_active: true, limit: 100 } as any),
                    existing.client_id ? clientsRepository.findById(existing.client_id, existing.salon_id) : Promise.resolve(null),
                ]);

                const branch = branches.find((b) => b.is_main) ?? branches[0] ?? null;
                const salonAddress = branch
                    ? [branch.address_line1, branch.address_line2, branch.city, branch.state, branch.pincode].filter(Boolean).join(", ")
                    : null;

                const staffNames: Record<string, string> = {};
                for (const s of staffList.data as any[]) {
                    staffNames[s.id] = [s.first_name, s.last_name].filter(Boolean).join(" ").trim() || s.email;
                }

                await sendReceiptDocument({
                    salonId: existing.salon_id,
                    phone: (existing as any).client_phone,
                    countryCode: (existing as any).client_phone_code ?? null,
                    salon: {
                        business_name: salonRecord?.business_name ?? (existing as any).salon_name ?? "our salon",
                        logo_url: (salonRecord as any)?.logo_url ?? null,
                        email: salonRecord?.email ?? null,
                        phone: salonRecord?.phone ?? null,
                        website_url: salonRecord?.website_url ?? null,
                        gst_number: salonRecord?.gst_number ?? null,
                    },
                    salonAddress,
                    client: {
                        name: clientRecord?.full_name ?? existing.client_name ?? "Valued Customer",
                        phone: clientRecord?.phone_number ?? (existing as any).client_phone ?? null,
                        email: clientRecord?.email ?? null,
                    },
                    sale,
                    items,
                    staffNames,
                    appointment: {
                        id: existing.id,
                        scheduledAt: existing.scheduled_at,
                        durationMinutes: existing.duration_minutes,
                        status: existing.status,
                        notes: existing.notes,
                    },
                    paidAmount: Number(sale.total_amount) || 0,
                    dueAmount: 0,
                    couponCode: null,
                });
            })().catch(() => {});
        }

        // ── Email: Appointment Completed receipt (to client) ──────────────────
        ;(async () => {
            try {
                const clientEmail = (existing as any).client_email;
                if (!clientEmail) { logger.info("[email] appointmentCompleted: no client email, skipping"); return; }
                logger.info(`[email] appointmentCompleted → to=${clientEmail}`);
                const allowed = await canSendEmail(existing.salon_id, "appointmentCompleted");
                if (!allowed) { logger.info("[email] appointmentCompleted: skipped (preference off)"); return; }
                await emailService.sendAppointmentCompletedEmail({
                    to:         clientEmail,
                    clientName: existing.client_name         ?? "Valued Customer",
                    salonName:  (existing as any).salon_name ?? "our salon",
                    services:   existing.services?.map((s: any) => s.name).join(", ") ?? "Service",
                    amount:     String(sale.total_amount     ?? "0"),
                });
                logger.info(`[email] appointmentCompleted sent to ${clientEmail}`);
            } catch (err: any) { logger.error("[email] appointmentCompleted failed:", err?.message ?? err); }
        })();

        // ── Email: New Payment (to salon owner) ───────────────────────────────
        ;(async () => {
            try {
                const ownerEmail = await salonsRepository.findOwnerEmailById(existing.salon_id);
                if (!ownerEmail) { logger.warn("[email] newPayment (checkout): owner has no email, skipping"); return; }
                logger.info(`[email] newPayment (checkout) → to=${ownerEmail}`);
                const allowed = await canSendEmail(existing.salon_id, "newPayment");
                if (!allowed) { logger.info("[email] newPayment: skipped (preference off)"); return; }
                await emailService.sendNewPaymentEmail({
                    to:            ownerEmail,
                    salonName:     (existing as any).salon_name ?? "your salon",
                    clientName:    existing.client_name         ?? "Walk-in",
                    amount:        String(sale.total_amount     ?? "0"),
                    paymentMethod: params.payment_method        ?? "N/A",
                    invoiceId:     sale.id.slice(0, 8).toUpperCase(),
                });
                logger.info(`[email] newPayment sent to ${ownerEmail}`);
            } catch (err: any) { logger.error("[email] newPayment (checkout) failed:", err?.message ?? err); }
        })();

        return { appointment, saleId: sale.id };
    },

    async exportAppointments(filters: {
        salon_id?: string;
        status?: string;
        start_date?: string;
        end_date?: string;
        format: "csv" | "excel";
    }): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
        const appointments = await appointmentsRepository.exportList({
            salon_id:   filters.salon_id,
            status:     filters.status,
            start_date: filters.start_date,
            end_date:   filters.end_date,
        });

        const headers = [
            "ID", "Title", "Status", "Client ID", "Staff ID", "Service ID",
            "Scheduled At", "Duration (min)", "Ends At",
            "Services", "Packages", "Products", "Memberships",
            "Sale ID", "Created At",
        ];

        const rows = appointments.map(a => [
            a.id,
            a.title                                               ?? "",
            a.status,
            a.client_id                                           ?? "Walk-in",
            a.staff_id                                            ?? "",
            a.service_id                                          ?? "",
            new Date(a.scheduled_at).toLocaleString("en-GB"),
            a.duration_minutes,
            a.ends_at ? new Date(a.ends_at).toLocaleString("en-GB") : "",
            (a.services         ?? []).map((s: any) => s.name).join(" | "),
            (a.package_items    ?? []).map((p: any) => p.name).join(" | "),
            (a.product_items    ?? []).map((p: any) => p.name).join(" | "),
            (a.membership_items ?? []).map((m: any) => m.name).join(" | "),
            a.sale_id                                             ?? "",
            new Date(a.created_at).toLocaleDateString("en-GB"),
        ]);

        if (filters.format === "csv") {
            const csvLines = [headers.join(","), ...rows.map(r => r.join(","))];
            return {
                buffer:      Buffer.from(csvLines.join("\n"), "utf-8"),
                contentType: "text/csv",
                filename:    "appointments.csv",
            };
        }

        const workbook = new ExcelJS.Workbook();
        const sheet    = workbook.addWorksheet("Appointments");
        sheet.addRow(headers).font = { bold: true };
        rows.forEach(r => sheet.addRow(r));
        sheet.columns.forEach(col => { col.width = 22; });

        const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
        return {
            buffer,
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename:    "appointments.xlsx",
        };
    },
};