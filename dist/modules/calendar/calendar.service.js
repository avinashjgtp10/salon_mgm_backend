"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calendarService = void 0;
const database_1 = __importDefault(require("../../config/database"));
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const calendar_repository_1 = require("./calendar.repository");
exports.calendarService = {
    async create(params) {
        const { requesterUserId, requesterRole, body } = params;
        logger_1.default.info("calendarService.create called", { requesterUserId, requesterRole, salonId: body.salon_id });
        if (body.staff_id) {
            const conflict = await calendar_repository_1.calendarRepository.hasConflict({
                staff_id: body.staff_id,
                scheduled_at: body.scheduled_at,
                duration_minutes: body.duration_minutes,
            });
            if (conflict)
                throw new error_middleware_1.AppError(409, "This staff member has a conflicting appointment at the selected time", "CONFLICT");
        }
        const appointment = await calendar_repository_1.calendarRepository.create(body, requesterUserId);
        logger_1.default.info("calendarService.create success", { appointmentId: appointment.id });
        return appointment;
    },
    async getById(id) {
        const appt = await calendar_repository_1.calendarRepository.findById(id);
        if (!appt)
            throw new error_middleware_1.AppError(404, "Appointment not found", "NOT_FOUND");
        return appt;
    },
    async list(filters) {
        const page = filters.page ?? 1;
        const limit = filters.limit ?? 50;
        const { data, total } = await calendar_repository_1.calendarRepository.list({ ...filters, page, limit });
        return { data, total, page, limit };
    },
    async update(params) {
        const { appointmentId, requesterUserId, requesterRole, patch } = params;
        logger_1.default.info("calendarService.update called", { appointmentId, requesterUserId, requesterRole });
        const existing = await calendar_repository_1.calendarRepository.findById(appointmentId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Appointment not found", "NOT_FOUND");
        if (["completed", "cancelled", "no_show"].includes(existing.status))
            throw new error_middleware_1.AppError(400, `Cannot update a ${existing.status} appointment`, "INVALID_STATUS");
        const staffId = patch.staff_id ?? existing.staff_id;
        const scheduledAt = patch.scheduled_at ?? existing.scheduled_at;
        const durationMins = patch.duration_minutes ?? existing.duration_minutes;
        if (staffId && (patch.staff_id || patch.scheduled_at || patch.duration_minutes)) {
            const conflict = await calendar_repository_1.calendarRepository.hasConflict({
                staff_id: staffId,
                scheduled_at: scheduledAt,
                duration_minutes: durationMins,
                excludeId: appointmentId,
            });
            if (conflict)
                throw new error_middleware_1.AppError(409, "This staff member has a conflicting appointment at the selected time", "CONFLICT");
        }
        const updated = await calendar_repository_1.calendarRepository.update(appointmentId, patch);
        logger_1.default.info("calendarService.update success", { appointmentId: updated.id });
        return updated;
    },
    async confirm(appointmentId) {
        const existing = await calendar_repository_1.calendarRepository.findById(appointmentId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Appointment not found", "NOT_FOUND");
        if (existing.status !== "booked")
            throw new error_middleware_1.AppError(400, "Only booked appointments can be confirmed", "INVALID_STATUS");
        return calendar_repository_1.calendarRepository.updateStatus(appointmentId, "confirmed");
    },
    async start(appointmentId) {
        const existing = await calendar_repository_1.calendarRepository.findById(appointmentId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Appointment not found", "NOT_FOUND");
        if (!["booked", "confirmed"].includes(existing.status))
            throw new error_middleware_1.AppError(400, "Appointment cannot be started in its current status", "INVALID_STATUS");
        return calendar_repository_1.calendarRepository.updateStatus(appointmentId, "in_progress");
    },
    async cancel(appointmentId, body) {
        const existing = await calendar_repository_1.calendarRepository.findById(appointmentId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Appointment not found", "NOT_FOUND");
        if (["completed", "cancelled"].includes(existing.status))
            throw new error_middleware_1.AppError(400, `Appointment is already ${existing.status}`, "INVALID_STATUS");
        return calendar_repository_1.calendarRepository.updateStatus(appointmentId, "cancelled", {
            cancel_reason: body.reason ?? null,
            cancelled_at: new Date().toISOString(),
        });
    },
    async noShow(appointmentId) {
        const existing = await calendar_repository_1.calendarRepository.findById(appointmentId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Appointment not found", "NOT_FOUND");
        if (!["booked", "confirmed"].includes(existing.status))
            throw new error_middleware_1.AppError(400, "Cannot mark as no-show in current status", "INVALID_STATUS");
        return calendar_repository_1.calendarRepository.updateStatus(appointmentId, "no_show");
    },
    async checkout(params) {
        const { appointmentId, requesterUserId, body } = params;
        logger_1.default.info("calendarService.checkout called", { appointmentId, requesterUserId });
        const appt = await calendar_repository_1.calendarRepository.findById(appointmentId);
        if (!appt)
            throw new error_middleware_1.AppError(404, "Appointment not found", "NOT_FOUND");
        if (appt.status === "completed")
            throw new error_middleware_1.AppError(400, "Appointment is already completed", "INVALID_STATUS");
        if (appt.status === "cancelled")
            throw new error_middleware_1.AppError(400, "Cannot checkout a cancelled appointment", "INVALID_STATUS");
        const subtotal = body.items.reduce((sum, item) => sum + item.unit_price * item.quantity - (item.discount_amount ?? 0), 0);
        const total = subtotal -
            (body.discount_amount ?? 0) +
            (body.tip_amount ?? 0) +
            (body.tax_amount ?? 0);
        const client = await database_1.default.connect();
        let sale;
        try {
            await client.query("BEGIN");
            const invoiceNumber = `INV-${Date.now()}`;
            const { rows: saleRows } = await client.query(`INSERT INTO sales (
          salon_id, client_id, appointment_id, staff_id,
          status, payment_method,
          subtotal, discount_amount, tip_amount, tax_amount, total_amount,
          notes, invoice_number, created_by
        )
        VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *`, [
                appt.salon_id,
                appt.client_id ?? null,
                appointmentId,
                appt.staff_id ?? null,
                body.payment_method?.toLowerCase() ?? null,
                subtotal,
                body.discount_amount ?? 0,
                body.tip_amount ?? 0,
                body.tax_amount ?? 0,
                total,
                body.notes ?? null,
                invoiceNumber,
                requesterUserId,
            ]);
            sale = saleRows[0];
            for (const item of body.items) {
                const itemTotalPrice = (item.unit_price * item.quantity - (item.discount_amount ?? 0)).toString();
                await client.query(`INSERT INTO sale_items (
            sale_id, item_type, item_id, name,
            quantity, unit_price, total_price
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
                    sale.id,
                    item.item_type,
                    item.item_id ?? null,
                    item.name,
                    item.quantity,
                    item.unit_price,
                    itemTotalPrice,
                ]);
            }
            await client.query(`UPDATE appointments
         SET sale_id = $1, status = 'completed', updated_at = NOW()
         WHERE id = $2`, [sale.id, appointmentId]);
            await client.query("COMMIT");
        }
        catch (err) {
            await client.query("ROLLBACK");
            throw err;
        }
        finally {
            client.release();
        }
        const updatedAppt = (await calendar_repository_1.calendarRepository.findById(appointmentId));
        logger_1.default.info("calendarService.checkout success", { appointmentId, saleId: sale.id, total });
        return { appointment: updatedAppt, sale };
    },
};
//# sourceMappingURL=calendar.service.js.map