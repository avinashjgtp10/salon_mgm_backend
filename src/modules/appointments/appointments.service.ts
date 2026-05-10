import ExcelJS from "exceljs";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { appointmentsRepository } from "./appointments.repository";
import { blockedTimesRepository } from "../blocked_times/blocked_times.repository";
import { salesService } from "../sales/sales.service";
import {
    Appointment,
    CreateAppointmentBody,
    UpdateAppointmentBody,
    CancelAppointmentBody,
} from "./appointments.types";

export const appointmentsService = {

    async create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateAppointmentBody;
    }): Promise<Appointment> {
        const { requesterUserId, body } = params;

        // Conflict check — only when staff_id is provided
        if (body.staff_id && body.staff_id.trim().length > 0) {
            const conflict = await appointmentsRepository.hasConflict({
                staffId: body.staff_id,
                scheduledAt: body.scheduled_at,
                durationMinutes: body.duration_minutes,
            });
            if (conflict) {
                throw new AppError(
                    409,
                    "Staff member already has an appointment at this time",
                    "CONFLICT"
                );
            }

            // Blocked-time check — reject booking if the slot is blocked for this staff
            const apptDate = new Date(body.scheduled_at);
            const dateStr  = apptDate.toISOString().slice(0, 10);
            const pad = (n: number) => String(n).padStart(2, "0");
            const startStr = `${pad(apptDate.getHours())}:${pad(apptDate.getMinutes())}`;
            const endMs    = apptDate.getTime() + body.duration_minutes * 60_000;
            const endDate  = new Date(endMs);
            const endStr   = `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;

            const blocked = await blockedTimesRepository.hasOverlap({
                staffId: body.staff_id,
                date: dateStr,
                startTime: startStr,
                endTime: endStr,
            });
            if (blocked) {
                throw new AppError(
                    409,
                    "This time slot is blocked for the selected staff.",
                    "BLOCKED_TIME"
                );
            }
        }

        // If services array provided but no top-level service_id, use first service
        if (!body.service_id && body.services && body.services.length > 0) {
            body.service_id = body.services[0].service_id;
        }

        // If services array provided but no top-level staff_id, use first service staff
        if (!body.staff_id && body.services && body.services.length > 0 && body.services[0].staff_id) {
            body.staff_id = body.services[0].staff_id ?? undefined;
        }

        const appointment = await appointmentsRepository.create(body, requesterUserId);
        logger.info("appointmentsService.create success", { appointmentId: appointment.id });
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
    }): Promise<Appointment[]> {
        const { salonId, clientId, date, staffId, status } = params;
        if (clientId) return appointmentsRepository.listByClientId(clientId);
        if (!salonId) throw new AppError(400, "salon_id or client_id is required", "VALIDATION_ERROR");
        return appointmentsRepository.listBySalonId(salonId, { date, staff_id: staffId, status });
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

        const newStaffId     = patch.staff_id        ?? existing.staff_id;
        const newScheduledAt = patch.scheduled_at    ?? existing.scheduled_at;
        const newDuration    = patch.duration_minutes ?? existing.duration_minutes;

        if (newStaffId && (patch.scheduled_at || patch.staff_id || patch.duration_minutes)) {
            const conflict = await appointmentsRepository.hasConflict({
                staffId: newStaffId,
                scheduledAt: newScheduledAt,
                durationMinutes: newDuration,
                excludeId: appointmentId,
            });
            if (conflict)
                throw new AppError(409, "Staff member already has an appointment at this time", "CONFLICT");
        }

        return appointmentsRepository.update(appointmentId, patch);
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

    async cancel(params: {
        appointmentId: string;
        requesterUserId: string;
        body: CancelAppointmentBody;
    }): Promise<Appointment> {
        const existing = await appointmentsRepository.findById(params.appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (["completed", "cancelled"].includes(existing.status))
            throw new AppError(400, `Appointment is already '${existing.status}'`, "BAD_REQUEST");
        return appointmentsRepository.updateStatus(params.appointmentId, "cancelled");
    },

    async delete(appointmentId: string): Promise<Appointment> {
        const existing = await appointmentsRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        const deleted = await appointmentsRepository.deleteById(appointmentId);
        if (!deleted) throw new AppError(500, "Failed to delete appointment", "INTERNAL_ERROR");
        logger.info("appointmentsService.delete success", { appointmentId });
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
        if (existing.sale_id)
            throw new AppError(400, "Appointment already has a linked sale", "BAD_REQUEST");

        // Build sale items from JSONB if no explicit items passed
        const resolvedItems = (saleItems && saleItems.length > 0)
            ? saleItems
            : [
                ...existing.services.map(s => ({
                    item_type: "service",
                    item_id: s.service_id,
                    name: s.name,
                    quantity: s.quantity,
                    unit_price: s.price,
                })),
                ...existing.package_items.map(p => ({
                    item_type: "service",
                    item_id: p.package_id,
                    name: p.name,
                    quantity: p.quantity,
                    unit_price: p.price,
                })),
                ...existing.product_items.map(pr => ({
                    item_type: "product",
                    item_id: pr.product_id ?? undefined,
                    name: pr.name,
                    quantity: pr.quantity,
                    unit_price: pr.price,
                })),
                ...existing.membership_items.map(m => ({
                    item_type: "membership",
                    item_id: m.membership_id ?? undefined,
                    name: m.name,
                    quantity: m.quantity,
                    unit_price: m.price,
                })),
            ];

        const { sale } = await salesService.create({
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
            a.title                                              ?? "",
            a.status,
            a.client_id                                          ?? "Walk-in",
            a.staff_id                                           ?? "",
            a.service_id                                         ?? "",
            new Date(a.scheduled_at).toLocaleString("en-GB"),
            a.duration_minutes,
            a.ends_at ? new Date(a.ends_at).toLocaleString("en-GB") : "",
            (a.services        ?? []).map((s: any) => s.name).join(" | "),
            (a.package_items   ?? []).map((p: any) => p.name).join(" | "),
            (a.product_items   ?? []).map((p: any) => p.name).join(" | "),
            (a.membership_items ?? []).map((m: any) => m.name).join(" | "),
            a.sale_id                                            ?? "",
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

        // Excel via ExcelJS
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