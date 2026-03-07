import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { appointmentsRepository } from "./appointments.repository";
import { salesService } from "../sales/sales.service";
import {
    Appointment, CreateAppointmentBody,
    UpdateAppointmentBody, CancelAppointmentBody,
} from "./appointments.types";

export const appointmentsService = {

    async create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateAppointmentBody;
    }): Promise<Appointment> {
        const { requesterUserId, body } = params;

        if (body.staff_id) {
            const conflict = await appointmentsRepository.hasConflict({
                staffId: body.staff_id,
                scheduledAt: body.scheduled_at,
                durationMinutes: body.duration_minutes,
            });
            if (conflict)
                throw new AppError(409, "Staff member already has an appointment at this time", "CONFLICT");
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
        salonId?: string; clientId?: string;
        date?: string; staffId?: string; status?: string;
    }): Promise<Appointment[]> {
        const { salonId, clientId, date, staffId, status } = params;
        if (clientId) return appointmentsRepository.listByClientId(clientId);
        if (!salonId) throw new AppError(400, "salon_id or client_id is required", "VALIDATION_ERROR");
        return appointmentsRepository.listBySalonId(salonId, { date, staff_id: staffId, status });
    },

    async update(params: {
        appointmentId: string; requesterUserId: string;
        requesterRole?: string; patch: UpdateAppointmentBody;
    }): Promise<Appointment> {
        const { appointmentId, patch } = params;
        const existing = await appointmentsRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (["completed", "cancelled", "no_show"].includes(existing.status))
            throw new AppError(400, `Cannot update an appointment with status '${existing.status}'`, "BAD_REQUEST");

        const newStaffId = patch.staff_id ?? existing.staff_id;
        const newScheduledAt = patch.scheduled_at ?? existing.scheduled_at;
        const newDuration = patch.duration_minutes ?? existing.duration_minutes;

        if (newStaffId && (patch.scheduled_at || patch.staff_id || patch.duration_minutes)) {
            const conflict = await appointmentsRepository.hasConflict({
                staffId: newStaffId, scheduledAt: newScheduledAt,
                durationMinutes: newDuration, excludeId: appointmentId,
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
        appointmentId: string; requesterUserId: string; body: CancelAppointmentBody;
    }): Promise<Appointment> {
        const existing = await appointmentsRepository.findById(params.appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (["completed", "cancelled"].includes(existing.status))
            throw new AppError(400, `Appointment is already '${existing.status}'`, "BAD_REQUEST");
        return appointmentsRepository.updateStatus(params.appointmentId, "cancelled");
    },

    async noShow(appointmentId: string): Promise<Appointment> {
        const existing = await appointmentsRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (!["booked", "confirmed"].includes(existing.status))
            throw new AppError(400, "Only booked/confirmed appointments can be marked no-show", "BAD_REQUEST");
        return appointmentsRepository.updateStatus(appointmentId, "no_show");
    },

    async checkout(params: {
        appointmentId: string; requesterUserId: string; requesterRole?: string;
        saleItems: any[]; discount_amount?: number; tip_amount?: number;
        tax_amount?: number; payment_method?: string; notes?: string;
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

        const { sale } = await salesService.create({
            requesterUserId, requesterRole,
            body: {
                salon_id: existing.salon_id,
                client_id: existing.client_id ?? undefined,
                appointment_id: appointmentId,
                staff_id: existing.staff_id ?? undefined,
                status: "draft",
                items: saleItems,
                ...saleExtras,
            } as any,
        });

        const appointment = await appointmentsRepository.linkSale(appointmentId, sale.id);
        return { appointment, saleId: sale.id };
    },
};
