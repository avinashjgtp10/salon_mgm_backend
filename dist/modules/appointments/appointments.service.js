"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appointmentsService = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const appointments_repository_1 = require("./appointments.repository");
const sales_service_1 = require("../sales/sales.service");
exports.appointmentsService = {
    async create(params) {
        const { requesterUserId, body } = params;
        // Only check conflict if staff_id is provided
        if (body.staff_id && body.staff_id.trim().length > 0) {
            const conflict = await appointments_repository_1.appointmentsRepository.hasConflict({
                staffId: body.staff_id,
                scheduledAt: body.scheduled_at,
                durationMinutes: body.duration_minutes,
            });
            if (conflict) {
                throw new error_middleware_1.AppError(409, "Staff member already has an appointment at this time", "CONFLICT");
            }
        }
        const appointment = await appointments_repository_1.appointmentsRepository.create(body, requesterUserId);
        logger_1.default.info("appointmentsService.create success", { appointmentId: appointment.id });
        return appointment;
    },
    async getById(id) {
        const appointment = await appointments_repository_1.appointmentsRepository.findById(id);
        if (!appointment)
            throw new error_middleware_1.AppError(404, "Appointment not found", "NOT_FOUND");
        return appointment;
    },
    async list(params) {
        const { salonId, clientId, date, staffId, status } = params;
        if (clientId)
            return appointments_repository_1.appointmentsRepository.listByClientId(clientId);
        if (!salonId)
            throw new error_middleware_1.AppError(400, "salon_id or client_id is required", "VALIDATION_ERROR");
        return appointments_repository_1.appointmentsRepository.listBySalonId(salonId, { date, staff_id: staffId, status });
    },
    async update(params) {
        const { appointmentId, patch } = params;
        const existing = await appointments_repository_1.appointmentsRepository.findById(appointmentId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Appointment not found", "NOT_FOUND");
        if (["completed", "cancelled", "no_show"].includes(existing.status))
            throw new error_middleware_1.AppError(400, `Cannot update an appointment with status '${existing.status}'`, "BAD_REQUEST");
        const newStaffId = patch.staff_id ?? existing.staff_id;
        const newScheduledAt = patch.scheduled_at ?? existing.scheduled_at;
        const newDuration = patch.duration_minutes ?? existing.duration_minutes;
        if (newStaffId && (patch.scheduled_at || patch.staff_id || patch.duration_minutes)) {
            const conflict = await appointments_repository_1.appointmentsRepository.hasConflict({
                staffId: newStaffId, scheduledAt: newScheduledAt,
                durationMinutes: newDuration, excludeId: appointmentId,
            });
            if (conflict)
                throw new error_middleware_1.AppError(409, "Staff member already has an appointment at this time", "CONFLICT");
        }
        return appointments_repository_1.appointmentsRepository.update(appointmentId, patch);
    },
    async confirm(appointmentId) {
        const existing = await appointments_repository_1.appointmentsRepository.findById(appointmentId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Appointment not found", "NOT_FOUND");
        if (existing.status !== "booked")
            throw new error_middleware_1.AppError(400, "Only booked appointments can be confirmed", "BAD_REQUEST");
        return appointments_repository_1.appointmentsRepository.updateStatus(appointmentId, "confirmed");
    },
    async start(appointmentId) {
        const existing = await appointments_repository_1.appointmentsRepository.findById(appointmentId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Appointment not found", "NOT_FOUND");
        if (!["booked", "confirmed"].includes(existing.status))
            throw new error_middleware_1.AppError(400, "Appointment must be booked or confirmed to start", "BAD_REQUEST");
        return appointments_repository_1.appointmentsRepository.updateStatus(appointmentId, "in_progress");
    },
    async cancel(params) {
        const existing = await appointments_repository_1.appointmentsRepository.findById(params.appointmentId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Appointment not found", "NOT_FOUND");
        if (["completed", "cancelled"].includes(existing.status))
            throw new error_middleware_1.AppError(400, `Appointment is already '${existing.status}'`, "BAD_REQUEST");
        return appointments_repository_1.appointmentsRepository.updateStatus(params.appointmentId, "cancelled");
    },
    async noShow(appointmentId) {
        const existing = await appointments_repository_1.appointmentsRepository.findById(appointmentId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Appointment not found", "NOT_FOUND");
        if (!["booked", "confirmed"].includes(existing.status))
            throw new error_middleware_1.AppError(400, "Only booked/confirmed appointments can be marked no-show", "BAD_REQUEST");
        return appointments_repository_1.appointmentsRepository.updateStatus(appointmentId, "no_show");
    },
    async checkout(params) {
        const { appointmentId, requesterUserId, requesterRole, saleItems, ...saleExtras } = params;
        const existing = await appointments_repository_1.appointmentsRepository.findById(appointmentId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Appointment not found", "NOT_FOUND");
        if (existing.status === "completed")
            throw new error_middleware_1.AppError(400, "Appointment is already completed", "BAD_REQUEST");
        if (existing.status === "cancelled")
            throw new error_middleware_1.AppError(400, "Cannot checkout a cancelled appointment", "BAD_REQUEST");
        if (existing.sale_id)
            throw new error_middleware_1.AppError(400, "Appointment already has a linked sale", "BAD_REQUEST");
        const { sale } = await sales_service_1.salesService.create({
            requesterUserId, requesterRole,
            body: {
                salon_id: existing.salon_id,
                client_id: existing.client_id ?? undefined,
                appointment_id: appointmentId,
                staff_id: existing.staff_id ?? undefined,
                status: "draft",
                items: saleItems,
                ...saleExtras,
            },
        });
        const appointment = await appointments_repository_1.appointmentsRepository.linkSale(appointmentId, sale.id);
        return { appointment, saleId: sale.id };
    },
};
//# sourceMappingURL=appointments.service.js.map