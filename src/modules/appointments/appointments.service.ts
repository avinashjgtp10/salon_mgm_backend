import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { appointmentsRepository } from "./appointments.repository";
import { salesRepository } from "../sales/sales.repository";
import type { SaleItem } from "../sales/sales.types";
import { productsRepository } from "../products/products.repository";
import { appointmentConsumablesService } from "../inventory/inventory.service";
import { commissionCalculationService } from "../commission/commissionCalculation.service";
import { blockedTimesRepository } from "../blocked_times/blocked_times.repository";
import { recordTransaction } from "../transactions/transaction-recorder.service";
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
import { computeBillTotals, rowsTotal, normalizeDiscountAppliesTo, ActiveTaxRow } from "../pricing/pricing.engine";
import { getActiveTaxes } from "../settings/tax.util";
import { paymentsRepository } from "../payments/payments.repository";
import { clientPackagesService } from "../client-packages/client-packages.service";
import {
    Appointment,
    AppointmentServiceConsumableRecord,
    CreateAppointmentBody,
    IncomingAppointmentServiceItem,
    UpdateAppointmentBody,
    CancelAppointmentBody,
} from "./appointments.types";

// A "Booked" (never paid) appointment has no persisted, tax-inclusive total
// anywhere — `appointments` only stores the raw inputs (discount, ex_charges,
// tip, line items), and `tax_breakdown` above is sourced entirely from the
// `payments` table, which has zero rows until the client actually pays. That
// left the calendar tooltip/chip showing a bare pre-tax item sum for any
// unpaid booking. This backfills tax_breakdown at READ time only — same
// shared engine as checkout/preview, no DB write, no new column — and ONLY
// when a real payment hasn't already produced one; once money has actually
// been collected, that payment's tax_breakdown is authoritative (reflects
// wallet/coupon actually applied) and must never be overridden by a fresh
// recompute here.
// Shared by backfillTaxBreakdown (read-time display) and update() (the
// paid/partial recompute-and-branch decision below) — both need "what would
// this appointment's bill actually total, from its raw stored inputs."
function computeAppointmentTotals(appt: {
    services?: any[]; package_items?: any[]; product_items?: any[]; membership_items?: any[];
    discount_type?: string; discount_value?: number; discount_applies_to?: unknown;
    ex_charges?: number; tip_amount?: number;
    include_gst?: boolean; membership_discount_used?: number | string;
}, activeTaxes: ActiveTaxRow[]) {
    const toRow = (items: any[] = []) => (items || []).map((i) => ({
        price: Number(i?.price) || 0,
        qty: Number(i?.quantity) || 1,
        isPackageService: !!i?.is_package_service,
    }));
    return computeBillTotals({
        actualAmounts: {
            // Package-covered rows are excluded from the taxable base — the
            // customer already paid for those sessions when they bought the
            // package, so this read-time recompute must not tax (or even
            // count) that value again. Mirrors payments.service.ts's own
            // `serviceTotal` filter; without it, this backfill silently
            // taxed the full pre-coverage subtotal on every read where the
            // cached tax_breakdown looked stale (see needsTaxBackfill).
            service:    rowsTotal(toRow(appt.services).filter((r) => !r.isPackageService)),
            packages:   rowsTotal(toRow(appt.package_items)),
            product:    rowsTotal(toRow(appt.product_items)),
            membership: rowsTotal(toRow(appt.membership_items)),
        },
        discountType: (appt.discount_type === "percentage" ? "percentage" : "flat"),
        discountValue: Number(appt.discount_value) || 0,
        // This bill's own "Apply to" selection. NULL on any appointment
        // predating the column, which normalizes to undefined = legacy scope,
        // so a read-time backfill reproduces exactly what that bill was
        // charged instead of re-pricing it under the new rule.
        discountAppliesTo: normalizeDiscountAppliesTo(appt.discount_applies_to),
        // A percentage/loyalty membership discount is a genuine pre-tax price
        // cut, same as the manual discount above — already collected onto
        // this appointment via findById()/listBySalonId()'s payments
        // subquery (MAX per appointment, not a per-call delta). Without this,
        // a read-time backfill (any appointment whose tax_breakdown is empty
        // or stale) recomputed computed_grand_total as if no membership
        // discount had ever been applied, overstating it by exactly that
        // amount — see ComputeBillTotalsInput.membershipDiscountAmount for
        // why this must go directly into grandTotal, not the discRatio.
        membershipDiscountAmount: Number(appt.membership_discount_used) || 0,
        // Respect this appointment's own persisted "Include GST" choice —
        // without this gate, a bill deliberately saved with GST excluded
        // gets the salon's active taxes silently added back in on every
        // read-time backfill/reprice (see include_gst on the Appointment type).
        taxes: appt.include_gst === false ? [] : activeTaxes,
        exCharges: Number(appt.ex_charges) || 0,
        tip: Number(appt.tip_amount) || 0,
    });
}

// Single source of truth for "does this appointment's cached tax_breakdown
// need recomputing" — a payment's snapshot is only trustworthy if nothing has
// been edited since it was taken; once an edit (appointments.updated_at)
// postdates the last payment, that snapshot describes a bill that no longer
// exists. Every caller below MUST use this (not its own "is tax_breakdown
// empty?" shortcut) — a caller that only checks emptiness will short-circuit
// past a stale-but-non-empty snapshot and keep showing pre-edit GST forever.
function needsTaxBackfill(appt: Appointment): boolean {
    if (!Array.isArray(appt.tax_breakdown) || appt.tax_breakdown.length === 0) return true;
    return !!appt.last_payment_at && new Date(appt.updated_at) > new Date(appt.last_payment_at);
}

function backfillTaxBreakdown(appt: Appointment, activeTaxes: ActiveTaxRow[]): Appointment {
    if (!needsTaxBackfill(appt)) return appt;
    const result = computeAppointmentTotals(appt, activeTaxes);
    return { ...appt, tax_breakdown: result.taxBreakdown, computed_grand_total: result.grandTotal };
}

// Once an appointment has a linked, paid sale, its real per-item GST lives on
// sale_items (see payments.service.ts/pricing.engine.ts's per-row
// allocation) — this attaches each item's own tax_amount back onto the
// matching entry in appt.services/package_items/product_items/
// membership_items, purely for READ-time display (receipt.ts via
// bookingMapper.ts); nothing is written back to the appointment's own JSONB
// columns. An unpaid appointment (no sale_id yet) is left untouched — there's
// nothing real to attach yet, and the frontend falls back to its existing
// blended-rate approximation in that case.
//
// Matching is by (item_type, item_id) first — falling back to (item_type,
// name+quantity+unit_price) for legacy sale_items rows recorded before
// item_id was reliably populated. Matches are consumed one at a time (not
// re-used) so two identical duplicate-service rows on the same appointment
// (see ServiceRow.tsx's duplicate-row support) each get their own sale_items
// row's tax rather than all of them collapsing onto the first match.
function attachItemTax(appt: Appointment, saleItems: SaleItem[]): Appointment {
    const remaining = [...saleItems];
    const takeMatch = (itemType: string, itemId: string | null | undefined, name: string, qty: number, price: number): number | undefined => {
        let idx = itemId ? remaining.findIndex((si) => si.item_type === itemType && si.item_id === itemId) : -1;
        if (idx === -1) {
            idx = remaining.findIndex((si) =>
                si.item_type === itemType &&
                !si.item_id &&
                si.name === name &&
                Number(si.quantity) === qty &&
                Math.abs(Number(si.unit_price) - price) < 0.01
            );
        }
        if (idx === -1) return undefined;
        const [match] = remaining.splice(idx, 1);
        return Number(match.tax_amount) || 0;
    };

    return {
        ...appt,
        services: (appt.services || []).map((s) => {
            const tax = takeMatch("service", s.service_id, s.name, Number(s.quantity) || 1, Number(s.price) || 0);
            return tax !== undefined ? { ...s, tax_amount: tax } : s;
        }),
        package_items: (appt.package_items || []).map((p) => {
            const tax = takeMatch("package", p.package_id, p.name, Number(p.quantity) || 1, Number(p.price) || 0);
            return tax !== undefined ? { ...p, tax_amount: tax } : p;
        }),
        product_items: (appt.product_items || []).map((pr) => {
            const tax = takeMatch("product", pr.product_id, pr.name, Number(pr.quantity) || 1, Number(pr.price) || 0);
            return tax !== undefined ? { ...pr, tax_amount: tax } : pr;
        }),
        membership_items: (appt.membership_items || []).map((m) => {
            const tax = takeMatch("membership", m.membership_id, m.name, Number(m.quantity) || 1, Number(m.price) || 0);
            return tax !== undefined ? { ...m, tax_amount: tax } : m;
        }),
    };
}

async function enrichItemsWithTax(appt: Appointment): Promise<Appointment> {
    if (!appt.sale_id) return appt;
    try {
        const saleItems = await salesRepository.findItemsBySaleId(appt.sale_id);
        return attachItemTax(appt, saleItems);
    } catch (err: any) {
        logger.warn("[appointments] per-item tax enrichment failed:", err?.message ?? err);
        return appt;
    }
}

// Batched form for list() — one query for every linked sale in the whole
// page/day instead of one DB round-trip per appointment (see
// salesRepository.findItemsBySaleIds).
async function enrichManyWithTax(appts: Appointment[]): Promise<Appointment[]> {
    const saleIds = appts.map((a) => a.sale_id).filter((id): id is string => !!id);
    if (saleIds.length === 0) return appts;
    try {
        const bySaleId = await salesRepository.findItemsBySaleIds(saleIds);
        return appts.map((a) => a.sale_id && bySaleId.has(a.sale_id) ? attachItemTax(a, bySaleId.get(a.sale_id)!) : a);
    } catch (err: any) {
        logger.warn("[appointments] batch per-item tax enrichment failed:", err?.message ?? err);
        return appts;
    }
}

// The no-show scheduler (appointments.scheduler.ts) flips a "booked" appointment
// to "no-show" once its end time passes, but it's a setInterval running inside
// one Node process — that never fires at all if the process restarts often or
// the deployment runs multiple/ephemeral instances. Deriving it here too (same
// condition the scheduler's own SQL uses: booked + ends_at < now) means the
// calendar shows the correct status on read regardless of whether that
// background sweep ever actually ran — it doesn't replace the batch flip
// (reports/filters that query status='no-show' directly still need it), it
// just guarantees what's displayed is never stuck showing stale "booked".
function deriveDisplayStatus(appt: Appointment): Appointment {
    if (appt.status !== "booked" || !appt.ends_at) return appt;
    if (new Date(appt.ends_at) >= new Date()) return appt;
    return { ...appt, status: "no-show" };
}

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

// ── Consumables helpers ──────────────────────────────────────────────────────
// A new appointment/edit request carries consumables nested under each
// service row (services[].consumables[]) — see IncomingAppointmentServiceItem.
// That data is peeled off here and persisted separately into
// appointment_service_consumables (relational, not JSON — see that table's
// migration for why), so the `services` JSONB column never carries it.

// Stamps a stable id onto any service row that doesn't already have one —
// closes the gap where a row's id used to be a purely frontend convention
// the backend never generated or relied on. Mutates in place; rows that
// already have an id (round-tripped from a prior save) are left untouched.
function assignServiceRowIds(services?: IncomingAppointmentServiceItem[]): void {
    if (!services) return;
    for (const s of services) {
        if (!s.id) s.id = randomUUID();
    }
}

// Flattens services[].consumables[] into one row per (service_row_id,
// product_id), ready for appointment_service_consumables. Must run AFTER
// assignServiceRowIds so every row has a stable id to key off. actual_qty
// defaults to the configured qty when the caller hasn't touched it yet.
function flattenServiceConsumables(
    services: IncomingAppointmentServiceItem[] | undefined,
    branchId: string | null
): AppointmentServiceConsumableRecord[] {
    if (!services) return [];
    const rows: AppointmentServiceConsumableRecord[] = [];
    for (const s of services) {
        if (!s.id || !s.consumables?.length) continue;
        for (const c of s.consumables) {
            if (!c.product_id) continue;
            const standardQty = Number(c.qty) || 0;
            const actualQty = c.actual_qty !== undefined && c.actual_qty !== null ? Number(c.actual_qty) : standardQty;
            rows.push({
                service_row_id: s.id,
                service_id: s.service_id ?? null,
                product_id: c.product_id,
                standard_qty: standardQty,
                actual_qty: actualQty,
                unit: c.unit ?? null,
                branch_id: branchId,
                staff_id: s.staff_id ?? null,
            });
        }
    }
    return rows;
}

// Strips the transient `consumables` field back off before the services
// array is written to the `services` JSONB column.
function stripConsumables(services: IncomingAppointmentServiceItem[] | undefined) {
    if (!services) return services;
    return services.map(({ consumables, ...rest }) => rest);
}

// Read-side counterpart to assignServiceRowIds/flattenServiceConsumables —
// joins appointment_service_consumables back onto each services[] item
// (matched by service_row_id === s.id) so a single GET still returns
// consumables in the same services[].consumables[] shape the frontend
// already sends, even though it's no longer stored inside that JSONB
// column. Only used by getById() (the edit-modal fetch) — the calendar's
// list/chip views don't display consumables, so skipping this there avoids
// an N+1 query per appointment on every calendar load.
async function attachConsumables(appt: Appointment): Promise<Appointment> {
    if (!appt.services?.length) return appt;
    const rows = await appointmentsRepository.getServiceConsumables(appt.id);
    if (!rows.length) return appt;
    const byRow = new Map<string, typeof rows>();
    for (const r of rows) {
        const list = byRow.get(r.service_row_id) ?? [];
        list.push(r);
        byRow.set(r.service_row_id, list);
    }
    return {
        ...appt,
        services: appt.services.map((s: any) => {
            const consumableRows = s.id ? byRow.get(s.id) : undefined;
            if (!consumableRows?.length) return s;
            return {
                ...s,
                consumables: consumableRows.map((r) => ({
                    product_id: r.product_id,
                    product_name: r.product_name ?? undefined,
                    qty: Number(r.standard_qty),
                    unit: r.unit ?? undefined,
                    actual_qty: Number(r.actual_qty),
                })),
            };
        }),
    };
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

        // Consumables never affect billing and are never deducted at booking
        // time (see appointment-consumables sequence in the feature docs) —
        // this just peels the declared recipe/actual-qty data off the JSONB
        // services array and stages it for a relational write once the
        // appointment row (and therefore its id) exists.
        assignServiceRowIds(body.services);
        let consumableRows: AppointmentServiceConsumableRecord[] = [];
        if (body.services?.some((s) => s.consumables?.length)) {
            const branchId = await appointmentConsumablesService.resolveBranchId(body.salon_id, body.branch_id ?? null);
            consumableRows = flattenServiceConsumables(body.services, branchId);
        }
        body.services = stripConsumables(body.services) as typeof body.services;

        const appointment = await appointmentsRepository.create(body, requesterUserId);
        logger.info("appointmentsService.create success", { appointmentId: appointment.id });

        if (consumableRows.length) {
            await appointmentsRepository.replaceServiceConsumables(appointment.id, consumableRows);
        }

        // Deduct stock for products sold in this appointment (fire-and-forget)
        const soldProducts = (body.product_items ?? []).filter(p => p.product_id);
        if (soldProducts.length > 0) {
            productsRepository.deductStock(
                soldProducts.map(p => ({ product_id: p.product_id!, quantity: p.quantity })),
                body.salon_id
            ).catch(err => logger.warn("Stock deduction failed (non-fatal)", { err: err?.message }));
        }

        // `appointment` here is the raw `INSERT ... RETURNING *` row
        // (appointments.repository.ts::create()), which has client_id but NOT
        // client_name (that's only ever populated by a JOIN to clients — see
        // findById() — appointments.types.ts marks it explicitly as a "joined
        // field, not a stored column"). Using `appointment.client_name`
        // directly always evaluated to undefined, so every "New Appointment
        // Booked" notification showed "Walk-in" regardless of which client
        // was actually picked. Re-fetched (with the join) once here and
        // reused below for WhatsApp automation, rather than querying twice.
        const full = appointment.client_id ? await appointmentsRepository.findById(appointment.id) : null;

        // Fire notification (fire-and-forget)
        notificationsService.create({
            salon_id: appointment.salon_id,
            type:     "appointment",
            title:    "New Appointment Booked",
            body:     `${full?.client_name ?? "Walk-in"} — ${formatDate(appointment.scheduled_at)} at ${formatTime(appointment.scheduled_at)}`,
            event_key: "newAppointment",
            scheduled_at: appointment.scheduled_at,
        }).catch((err: any) => {
            logger.error("New appointment notification failed", {
                appointmentId: appointment.id,
                salonId: appointment.salon_id,
                message: err?.message,
                stack: err?.stack,
                error: err,
            });
        });

        // ── WhatsApp Automation: Appointment Confirmation ─────────────────────
        // Dedup check — NEVER send confirmation twice for the same appointment
        if (appointment.client_id) {
            try {
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
                            dedupeByReference: true,
                        }).catch(() => {});
                    }
                }
            } catch (err: any) {
                // Never block core flow — but log so a real bug here isn't invisible.
                logger.error("[WA-AUTO] appointment notification trigger failed:", err?.message ?? err);
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
        const found = await appointmentsRepository.findById(id);
        if (!found) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        let appointment = await enrichItemsWithTax(deriveDisplayStatus(found));
        appointment = await attachConsumables(appointment);
        if (!needsTaxBackfill(appointment)) return appointment;
        const activeTaxes = await getActiveTaxes(appointment.salon_id).catch(() => []);
        return backfillTaxBreakdown(appointment, activeTaxes);
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
        if (clientId) {
            let appts = (await appointmentsRepository.listByClientId(clientId)).map(deriveDisplayStatus);
            appts = await enrichManyWithTax(appts);
            const needsBackfill = appts.some(needsTaxBackfill);
            if (!needsBackfill || appts.length === 0) return appts;
            const activeTaxes = await getActiveTaxes(appts[0].salon_id).catch(() => []);
            return appts.map((a) => backfillTaxBreakdown(a, activeTaxes));
        }
        if (!salonId) throw new AppError(400, "salon_id or client_id is required", "VALIDATION_ERROR");
        const rawResult = await appointmentsRepository.listBySalonId(salonId, {
            date, staff_id: staffId, status,
            start_date: startDate, end_date: endDate,
            page, limit,
        });
        const enrichedData = await enrichManyWithTax(rawResult.data.map(deriveDisplayStatus));
        const result = { ...rawResult, data: enrichedData };
        const needsBackfill = result.data.some(needsTaxBackfill);
        if (!needsBackfill) return result;
        const activeTaxes = await getActiveTaxes(salonId).catch(() => []);
        return { ...result, data: result.data.map((a) => backfillTaxBreakdown(a, activeTaxes)) };
    },

    async update(params: {
        appointmentId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateAppointmentBody;
    }): Promise<Appointment> {
        const { appointmentId } = params;
        let patch = params.patch;
        const existing = await appointmentsRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");

        // "no-show" is the one non-terminal terminal state: a reschedule (time,
        // staff, or duration change) brings it back to "booked" instead of being
        // blocked outright, since the whole point of dragging/editing it is to
        // give the client a new slot.
        const isReschedule = "scheduled_at" in patch || "staff_id" in patch || "duration_minutes" in patch;
        // Whether this patch actually changes what's owed — distinct from a
        // pure reschedule/staff-reassignment/note edit, which never needs to
        // touch payment status. Field list mirrors computeAppointmentTotals's
        // inputs exactly so this decision and the recompute below can never
        // disagree about what "changed the bill" means.
        const isContentEdit = ["services", "package_items", "product_items", "membership_items",
                                "discount_value", "discount_type", "discount_applies_to",
                                "ex_charges", "tip_amount", "include_gst"]
                                .some((k) => k in patch);

        if (existing.status === "no-show" && isReschedule) {
            patch = { ...patch, status: "booked" };
        } else if (existing.status === "cancelled" || existing.status === "deleted") {
            throw new AppError(400, `Cannot update an appointment with status '${existing.status}'`, "BAD_REQUEST");
        } else if ((existing.status === "paid" || existing.status === "partial") && isContentEdit) {
            // Editing a paid or partially-paid appointment's actual items:
            // recompute the true bill from the merged (existing + patch)
            // inputs, using the same shared engine every other charge/preview
            // call site uses, then compare against what's already been
            // collected — never trust the frontend's own guess of the total.
            const merged = {
                services:         patch.services         ?? existing.services,
                package_items:    patch.package_items    ?? existing.package_items,
                product_items:    patch.product_items    ?? existing.product_items,
                membership_items: patch.membership_items ?? existing.membership_items,
                discount_type:    patch.discount_type     ?? existing.discount_type,
                discount_value:   patch.discount_value    ?? existing.discount_value,
                discount_applies_to: patch.discount_applies_to ?? existing.discount_applies_to,
                ex_charges:       patch.ex_charges        ?? existing.ex_charges,
                tip_amount:       patch.tip_amount         ?? existing.tip_amount,
                include_gst:      patch.include_gst        ?? existing.include_gst,
            };
            const activeTaxes = await getActiveTaxes(existing.salon_id).catch(() => []);
            const newGrandTotal = computeAppointmentTotals(merged, activeTaxes).grandTotal;
            const existingPaid = await paymentsRepository.getTotalPaidForAppointment(appointmentId);
            logger.info("[DEBUG update() reprice]", {
                appointmentId, existingStatus: existing.status, isContentEdit,
                newGrandTotal, existingPaid, activeTaxesCount: activeTaxes.length,
                patchKeys: Object.keys(patch),
            });

            if (newGrandTotal < existingPaid - 0.5) {
                // Overpayment: the edit would take the bill below what's
                // already been collected. There's no refund workflow — block
                // the save rather than silently create/hide an overpaid state.
                throw new AppError(
                    400,
                    "This change would reduce the total below the amount already paid. Cancel or handle removals separately instead of editing a paid appointment down.",
                    "OVERPAYMENT_BLOCKED",
                );
            } else if (newGrandTotal > existingPaid + 0.5) {
                patch = { ...patch, status: "partial" };
                // Only a genuinely Paid booking being reopened needs the
                // stay-editable flag — a booking that was already partial
                // (a real deposit) keeps its existing lock behavior untouched.
                if (existing.status === "paid") patch = { ...patch, reopened_from_paid: true };
            } else {
                patch = { ...patch, status: "paid" };
            }
        }

        // Consumables never affect billing (stripped off before the merged
        // reprice above even sees them) and are only ever actually deducted
        // once the appointment has genuinely been paid — see the two cases
        // below. Neither is stock-validated: an out-of-stock consumable must
        // never block editing or billing an appointment. The deduction runs
        // with allowNegative (see inventory.service.ts), recording the usage
        // and flooring products.amount at 0 rather than refusing the edit.
        let newConsumableRows: AppointmentServiceConsumableRecord[] | null = null;
        let applyConsumableChange: (() => Promise<void>) | null = null;
        if (patch.services !== undefined) {
            assignServiceRowIds(patch.services as IncomingAppointmentServiceItem[]);
            const hadPriorDeduction = existing.status === "paid" || existing.reopened_from_paid === true;
            // patch.status was already finalized by the reprice block above
            // (if it ran) — read it synchronously rather than waiting for
            // appointmentsRepository.update()'s return value, since the
            // validation below must happen BEFORE that write.
            const intendedStatus = (patch.status as string | undefined) ?? existing.status;
            const wasFirstTimePaid = !hadPriorDeduction && intendedStatus === "paid";

            const branchId = wasFirstTimePaid || hadPriorDeduction
                ? await appointmentConsumablesService.resolveBranchId(existing.salon_id, existing.branch_id)
                : null;
            newConsumableRows = flattenServiceConsumables(patch.services as IncomingAppointmentServiceItem[], branchId);
            patch = { ...patch, services: stripConsumables(patch.services as IncomingAppointmentServiceItem[]) as typeof patch.services };

            if (wasFirstTimePaid && branchId) {
                const items = appointmentConsumablesService.collectServiceRowItems(newConsumableRows);
                if (items.length) {
                    applyConsumableChange = () => appointmentConsumablesService.completeAppointment(
                        { rows: newConsumableRows!, salonId: existing.salon_id, branchId, bookingId: appointmentId, userId: params.requesterUserId }
                    );
                }
            } else if (hadPriorDeduction && branchId) {
                const priorRows = await appointmentsRepository.getServiceConsumables(appointmentId);
                const { toDeduct, toRestore } = appointmentConsumablesService.computeDelta(priorRows, newConsumableRows);
                if (toDeduct.length || toRestore.length) {
                    applyConsumableChange = () => appointmentConsumablesService.applyDelta({
                        toDeduct, toRestore, salonId: existing.salon_id, branchId, bookingId: appointmentId, userId: params.requesterUserId,
                    });
                }
            }
        }

        // Overlapping appointments for the same staff are allowed (e.g. hair color
        // processing time) — no conflict check on reschedule/staff/duration changes.

        const updated = await appointmentsRepository.update(appointmentId, patch);

        // Apply the pre-validated consumable deduction/return now that the
        // core appointment write has succeeded, then persist the new
        // current-state rows. A failure here (only possible if a genuine
        // race lost stock between the pre-check above and now) is logged
        // loudly rather than silently swallowed — the appointment patch has
        // already committed at this point, matching this function's existing
        // "product_items stock adjustment is best-effort after the main
        // write" convention below, just with an upfront hard-block instead
        // of none at all.
        if (newConsumableRows !== null) {
            if (applyConsumableChange) {
                try {
                    await applyConsumableChange();
                } catch (err: any) {
                    logger.error("Consumable stock deduction/adjustment failed after appointment update committed", {
                        appointmentId, message: err?.message,
                    });
                }
            }
            await appointmentsRepository.replaceServiceConsumables(appointmentId, newConsumableRows);
        }

        // Reassigning a paid/partial appointment to a different staff member
        // (calendar drag-drop or manual edit) must also move the already-
        // recorded sale's revenue/commission credit to the new staff —
        // otherwise Staff Performance/Commission reports keep crediting
        // whoever the sale was originally attributed to, silently
        // disagreeing with what the calendar now shows. Booked/unpaid
        // appointments have no linked sale yet, so this is a no-op for them.
        if (
            patch.staff_id &&
            patch.staff_id !== existing.staff_id &&
            (existing.status === "paid" || existing.status === "partial")
        ) {
            salesRepository.reassignStaffForAppointment(appointmentId, patch.staff_id)
                .catch(err => logger.warn("Sale staff reassignment failed (non-fatal)", {
                    appointmentId, newStaffId: patch.staff_id, err: err?.message,
                }));
        }

        // Same idea for the DATE: moving a paid/partial appointment must carry
        // its already-recorded bill with it. Reports date every row off
        // sales.created_at, which is stamped once when the sale is first
        // written and was never revised afterwards — so editing a paid bill's
        // date moved it on the calendar while every report kept reporting it
        // under the original date.
        //
        // Deliberately AWAITED, unlike the staff reassignment above. That one
        // only affects commission attribution nobody reads back in the same
        // breath, but this changes what the reports show — and the client
        // typically reloads them straight after saving. Fired-and-forgotten,
        // the response returned before the re-dating landed, so that reload
        // raced the write and still showed the old date until the user
        // refreshed again. Awaiting makes the save mean "the bill has moved".
        // Still non-fatal: a failure here must not reject an otherwise good
        // appointment update.
        if (
            patch.scheduled_at &&
            new Date(patch.scheduled_at).getTime() !== new Date(existing.scheduled_at).getTime() &&
            (existing.status === "paid" || existing.status === "partial")
        ) {
            try {
                await salesRepository.updateDateForAppointment(appointmentId, patch.scheduled_at);
            } catch (err: any) {
                logger.warn("Sale re-dating failed (non-fatal)", {
                    appointmentId, newDate: patch.scheduled_at, err: err?.message,
                });
            }
        }

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
                scheduled_at: updated.scheduled_at,
            }).catch((err: any) => {
                logger.error("Appointment update notification failed", {
                    appointmentId: updated.id,
                    salonId: existing.salon_id,
                    message: err?.message,
                    stack: err?.stack,
                    error: err,
                });
            });
        }

        // ── Package linkage: keep the schedule row's denormalized date in sync ──
        // Same appointment_id, same schedule row — a reschedule never creates a
        // duplicate. No-op for any appointment not created by the package-sale
        // scheduling flow.
        if (patch.scheduled_at && new Date(patch.scheduled_at).getTime() !== new Date(existing.scheduled_at).getTime()) {
            clientPackagesService.rescheduleForAppointment(appointmentId, patch.scheduled_at)
                .catch((err: any) => logger.error("[client-packages] rescheduleForAppointment failed:", err?.message ?? err));
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
                            dedupeByReference: true,
                        }).catch(() => {});
                    }
                }
            } catch (err: any) {
                // Never block core flow — but log so a real bug here isn't invisible.
                logger.error("[WA-AUTO] appointment notification trigger failed:", err?.message ?? err);
            }
        }

        return updated;
    },

    async cancel(params: {
        appointmentId: string;
        requesterUserId: string;
        body: CancelAppointmentBody;
    }): Promise<Appointment> {
        const existing = await appointmentsRepository.findById(params.appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (["paid", "cancelled", "deleted"].includes(existing.status))
            throw new AppError(400, `Appointment is already '${existing.status}'`, "BAD_REQUEST");

        const cancelled = await appointmentsRepository.updateStatus(params.appointmentId, "cancelled");

        // ── Package linkage: cancel never deducts the reserved session — the
        // service becomes reschedulable again. No-op for any appointment not
        // created by the package-sale scheduling flow.
        clientPackagesService.cancelScheduleForAppointment(params.appointmentId)
            .catch((err: any) => logger.error("[client-packages] cancelScheduleForAppointment failed:", err?.message ?? err));

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
            event_key: "appointmentCancelled",
            scheduled_at: existing.scheduled_at,
        }).catch((err: any) => {
            logger.error("Appointment cancellation notification failed", {
                appointmentId: existing.id,
                salonId: existing.salon_id,
                message: err?.message,
                stack: err?.stack,
                error: err,
            });
        });

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
                dedupeByReference: true,
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

    // Bulk delete for the reports multi-select UI. Reuses the same per-appointment
    // delete() logic (hard delete + stock restore) so behavior stays identical to
    // deleting one at a time — just looped, with per-id failures collected instead
    // of aborting the whole batch.
    async bulkDelete(appointmentIds: string[]): Promise<{ deleted: string[]; failed: { id: string; reason: string }[] }> {
        const deleted: string[] = [];
        const failed: { id: string; reason: string }[] = [];
        for (const id of appointmentIds) {
            try {
                await this.delete(id);
                deleted.push(id);
            } catch (err: any) {
                failed.push({ id, reason: err?.message || "Unknown error" });
            }
        }
        logger.info("appointmentsService.bulkDelete complete", { requested: appointmentIds.length, deleted: deleted.length, failed: failed.length });
        return { deleted, failed };
    },

    async checkout(params: {
        appointmentId: string;
        requesterUserId: string;
        requesterRole?: string;
        saleItems: any[];
        discount_amount?: number;
        tip_amount?: number;
        tax_amount?: number;
        ex_charges?: number;
        payment_method?: string;
        notes?: string;
    }): Promise<{ appointment: Appointment; saleId: string }> {
        const { appointmentId, requesterUserId, requesterRole, saleItems, ...saleExtras } = params;
        const existing = await appointmentsRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");

        // NOTE: `existing.status` may already be "paid" here even on a first-ever
        // checkout call — payments.service.ts sets status the instant a payment
        // lands (before checkout runs), so "paid" no longer means "already
        // checked out." The real marker for that is `sale_id`, handled below via
        // the pre-existing-sale lookup (and the fallback `sale_id` guard further down).
        if (["cancelled", "deleted"].includes(existing.status))
            throw new AppError(400, `Cannot checkout a '${existing.status}' appointment`, "BAD_REQUEST");

        // ── Check if payments service already auto-created a sale for this appointment ─
        // This happens when POST /api/v1/payments runs before checkout.
        // In that case: use the existing sale, fire commission on it, mark appointment paid.
        const preExistingSale = await salesRepository.findByAppointmentId(appointmentId);
        if (preExistingSale) {
            logger.info("appointmentsService.checkout: using pre-existing sale from payments", {
                appointmentId, saleId: preExistingSale.id,
            });

            // Link sale to appointment if not already linked
            if (!existing.sale_id) {
                await appointmentsRepository.linkSale(appointmentId, preExistingSale.id);
            }

            // Fire commission on the existing sale items.
            const saleItems = await salesRepository.findItemsBySaleId(preExistingSale.id);
            // checkout() can be re-entered whenever a second payment fully
            // settles this appointment (e.g. collecting the difference after
            // an edit) — without this, re-firing calculateForSale on the same
            // sale_id would insert a second, duplicate set of commission rows
            // instead of replacing the first. Awaited (not fire-and-forget)
            // so the clear always completes before the new calculation
            // inserts — reverseForSale only deletes rows still 'pending', so
            // any commission already paid out is left untouched.
            await commissionCalculationService.reverseForSale(preExistingSale.id).catch(() => {});
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

            // Mark appointment as paid
            const completedAppt = await appointmentsRepository.updateStatus(appointmentId, "paid");

            // ── Package redemption: this appointment was booked from a package
            // sale's schedule-at-purchase flow — deduct the one session it was
            // reserved for now that it's actually complete. No-op for any
            // appointment not created that way. Never blocks checkout on failure.
            await clientPackagesService
                .redeemForAppointmentIfScheduled(existing.salon_id, appointmentId, existing.staff_name ?? "Staff")
                .catch((err: any) => logger.error("[client-packages] redemption on checkout failed:", err?.message ?? err));

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
                                dedupeByReference: true,
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
                                status:          "paid",
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
                        invoiceId:     preExistingSale.invoice_number ?? "",
                    });
                } catch (err: any) { logger.error("[email] newPayment (preexisting) failed:", err?.message ?? err); }
            })();

            return { appointment: completedAppt, saleId: preExistingSale.id };
        }

        // No pre-existing sale — standard flow
        if (existing.sale_id) {
            // A sale_id can be set but dangling — the sale it points at was
            // hard-deleted with no cleanup on this side (no FK existed before).
            // Without this check, a checkout on such an appointment would be
            // permanently stuck: it can never re-create a sale (blocked here)
            // and can never self-heal (findByAppointmentId already returned
            // null above, since that sale doesn't exist).
            const linkedSale = await salesRepository.findById(existing.sale_id);
            if (linkedSale) {
                throw new AppError(400, "Appointment already has a linked sale", "BAD_REQUEST");
            }
            logger.warn("appointmentsService.checkout: clearing dangling sale_id, falling through to re-create", {
                appointmentId, staleSaleId: existing.sale_id,
            });
            await appointmentsRepository.clearSaleId(appointmentId);
        }

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
                    item_type: "package",
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

        // This fallback path (no explicit saleItems from the caller) never ran
        // the full pricing engine per-row — unlike payments.service.ts's
        // primary checkout path, there's no per-row wallet/discount data
        // available here. Simplest safe approximation: split the one
        // aggregate tax_amount across these items by their own value share,
        // last item absorbing the rounding remainder — strictly better than
        // today's "no per-item tax at all," at zero risk to the bill total
        // itself (saleExtras.tax_amount is untouched).
        if (!(saleItems && saleItems.length > 0) && (Number(saleExtras.tax_amount) || 0) > 0) {
            const totalTax = Number(saleExtras.tax_amount) || 0;
            const values = resolvedItems.map((i: any) => (Number(i.unit_price) || 0) * (Number(i.quantity) || 1));
            const sumValues = values.reduce((s, v) => s + v, 0);
            if (sumValues > 0) {
                let allocated = 0;
                resolvedItems.forEach((item: any, i: number) => {
                    const isLast = i === resolvedItems.length - 1;
                    const share = isLast ? totalTax - allocated : Math.round(totalTax * (values[i] / sumValues) * 100) / 100;
                    allocated += share;
                    item.tax_amount = share;
                    item.taxable_amount = values[i];
                });
            }
        }

        const { sale, items } = await recordTransaction({
            salon_id:        existing.salon_id,
            client_id:       existing.client_id  ?? undefined,
            appointment_id:  appointmentId,
            staff_id:        existing.staff_id   ?? undefined,
            origin:          "quick_sell",
            payment_label:   saleExtras.payment_method || "",
            // Date the sale to the appointment's real scheduled time, not
            // whenever checkout happened to run — see the matching comment
            // on payments.service.ts's recordTransaction() calls.
            created_at:      existing.scheduled_at,
            discount_amount: saleExtras.discount_amount,
            tax_amount:      saleExtras.tax_amount,
            // ex_charges counts as revenue, tip_amount does not (passes through
            // to staff) — see recordTransaction()/salesRepository.create().
            // Fall back to the appointment's own stored values when the caller
            // (this fallback path) doesn't explicitly pass them.
            ex_charges:      saleExtras.ex_charges ?? existing.ex_charges,
            tip_amount:      saleExtras.tip_amount ?? existing.tip_amount,
            notes:           saleExtras.notes,
            items:           resolvedItems as any,
        });

        const appointment = await appointmentsRepository.linkSale(appointmentId, sale.id);

        // ── Package redemption: this appointment was booked from a package
        // sale's schedule-at-purchase flow — deduct the one session it was
        // reserved for now that it's actually complete. No-op for any
        // appointment not created that way. Never blocks checkout on failure.
        await clientPackagesService
            .redeemForAppointmentIfScheduled(existing.salon_id, appointmentId, existing.staff_name ?? "Staff")
            .catch((err: any) => logger.error("[client-packages] redemption on checkout failed:", err?.message ?? err));

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
                    '3': sale.invoice_number ?? '',
                },
                referenceId:   sale.id,
                referenceType: 'invoice',
                dedupeByReference: true,
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
                    invoiceId:     sale.invoice_number ?? "",
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
