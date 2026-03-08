import pool from "../../config/database";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { calendarRepository } from "./calendar.repository";
import {
    Appointment,
    CreateAppointmentBody,
    UpdateAppointmentBody,
    CancelAppointmentBody,
    CheckoutAppointmentBody,
    ListAppointmentsFilters,
} from "./calendar.types";

export const calendarService = {

    async create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateAppointmentBody;
    }): Promise<Appointment> {
        const { requesterUserId, requesterRole, body } = params;

        logger.info("calendarService.create called", { requesterUserId, requesterRole, salonId: body.salon_id });

        if (body.staff_id) {
            const conflict = await calendarRepository.hasConflict({
                staff_id: body.staff_id,
                scheduled_at: body.scheduled_at,
                duration_minutes: body.duration_minutes,
            });
            if (conflict)
                throw new AppError(409, "This staff member has a conflicting appointment at the selected time", "CONFLICT");
        }

        const appointment = await calendarRepository.create(body, requesterUserId);

        logger.info("calendarService.create success", { appointmentId: appointment.id });

        return appointment;
    },

    async getById(id: string): Promise<Appointment> {
        const appt = await calendarRepository.findById(id);
        if (!appt) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        return appt;
    },

    async list(
        filters: ListAppointmentsFilters
    ): Promise<{ data: Appointment[]; total: number; page: number; limit: number }> {
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 50;
        const { data, total } = await calendarRepository.list({ ...filters, page, limit });
        return { data, total, page, limit };
    },

    async update(params: {
        appointmentId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateAppointmentBody;
    }): Promise<Appointment> {
        const { appointmentId, requesterUserId, requesterRole, patch } = params;

        logger.info("calendarService.update called", { appointmentId, requesterUserId, requesterRole });

        const existing = await calendarRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");

        if (["completed", "cancelled", "no_show"].includes(existing.status))
            throw new AppError(400, `Cannot update a ${existing.status} appointment`, "INVALID_STATUS");

        const staffId = patch.staff_id ?? existing.staff_id;
        const scheduledAt = patch.scheduled_at ?? existing.scheduled_at;
        const durationMins = patch.duration_minutes ?? existing.duration_minutes;

        if (staffId && (patch.staff_id || patch.scheduled_at || patch.duration_minutes)) {
            const conflict = await calendarRepository.hasConflict({
                staff_id: staffId,
                scheduled_at: scheduledAt,
                duration_minutes: durationMins,
                excludeId: appointmentId,
            });
            if (conflict)
                throw new AppError(409, "This staff member has a conflicting appointment at the selected time", "CONFLICT");
        }

        const updated = await calendarRepository.update(appointmentId, patch);

        logger.info("calendarService.update success", { appointmentId: updated.id });

        return updated;
    },

    async confirm(appointmentId: string): Promise<Appointment> {
        const existing = await calendarRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (existing.status !== "booked")
            throw new AppError(400, "Only booked appointments can be confirmed", "INVALID_STATUS");
        return calendarRepository.updateStatus(appointmentId, "confirmed");
    },

    async start(appointmentId: string): Promise<Appointment> {
        const existing = await calendarRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (!["booked", "confirmed"].includes(existing.status))
            throw new AppError(400, "Appointment cannot be started in its current status", "INVALID_STATUS");
        return calendarRepository.updateStatus(appointmentId, "in_progress");
    },

    async cancel(appointmentId: string, body: CancelAppointmentBody): Promise<Appointment> {
        const existing = await calendarRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (["completed", "cancelled"].includes(existing.status))
            throw new AppError(400, `Appointment is already ${existing.status}`, "INVALID_STATUS");
        return calendarRepository.updateStatus(appointmentId, "cancelled", {
            cancel_reason: body.reason ?? null,
            cancelled_at: new Date().toISOString(),
        });
    },

    async noShow(appointmentId: string): Promise<Appointment> {
        const existing = await calendarRepository.findById(appointmentId);
        if (!existing) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (!["booked", "confirmed"].includes(existing.status))
            throw new AppError(400, "Cannot mark as no-show in current status", "INVALID_STATUS");
        return calendarRepository.updateStatus(appointmentId, "no_show");
    },

    async checkout(params: {
        appointmentId: string;
        requesterUserId: string;
        body: CheckoutAppointmentBody;
    }): Promise<{ appointment: Appointment; sale: Record<string, unknown> }> {
        const { appointmentId, requesterUserId, body } = params;

        logger.info("calendarService.checkout called", { appointmentId, requesterUserId });

        const appt = await calendarRepository.findById(appointmentId);
        if (!appt) throw new AppError(404, "Appointment not found", "NOT_FOUND");
        if (appt.status === "completed")
            throw new AppError(400, "Appointment is already completed", "INVALID_STATUS");
        if (appt.status === "cancelled")
            throw new AppError(400, "Cannot checkout a cancelled appointment", "INVALID_STATUS");

        const subtotal = body.items.reduce(
            (sum, item) => sum + item.unit_price * item.quantity - (item.discount_amount ?? 0),
            0
        );
        const total =
            subtotal -
            (body.discount_amount ?? 0) +
            (body.tip_amount ?? 0) +
            (body.tax_amount ?? 0);

        const client = await pool.connect();
        let sale: Record<string, unknown>;

        try {
            await client.query("BEGIN");

            const { rows: saleRows } = await client.query(
                `INSERT INTO sales (
          salon_id, branch_id, client_id, appointment_id,
          status,
          subtotal, discount_amount, tip_amount, tax_amount, total_amount,
          notes, created_by
        )
        VALUES ($1, $2, $3, $4, 'paid', $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
                [
                    appt.salon_id,
                    appt.branch_id ?? null,
                    appt.client_id ?? null,
                    appointmentId,
                    subtotal,
                    body.discount_amount ?? 0,
                    body.tip_amount ?? 0,
                    body.tax_amount ?? 0,
                    total,
                    body.notes ?? null,
                    requesterUserId,
                ]
            );
            sale = saleRows[0];

            for (const item of body.items) {
                await client.query(
                    `INSERT INTO sale_items (
            sale_id, item_type, item_id, name,
            quantity, unit_price, discount_amount, staff_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        sale.id,
                        item.item_type,
                        item.item_id ?? null,
                        item.name,
                        item.quantity,
                        item.unit_price,
                        item.discount_amount ?? 0,
                        item.staff_id ?? null,
                    ]
                );
            }

            await client.query(
                `UPDATE appointments
         SET sale_id = $1, status = 'completed', updated_at = NOW()
         WHERE id = $2`,
                [sale.id, appointmentId]
            );

            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }

        const updatedAppt = (await calendarRepository.findById(appointmentId))!;

        logger.info("calendarService.checkout success", { appointmentId, saleId: sale.id, total });

        return { appointment: updatedAppt, sale };
    },
};
