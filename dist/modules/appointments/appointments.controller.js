"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appointmentsController = void 0;
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const appointments_service_1 = require("./appointments.service");
exports.appointmentsController = {
    async create(req, res, next) {
        try {
            const userId = req.user?.userId;
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const appointment = await appointments_service_1.appointmentsService.create({
                requesterUserId: userId, requesterRole: req.user?.role,
                body: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 201, appointment, "Appointment created successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async getById(req, res, next) {
        try {
            const id = String(req.params.id || "").trim();
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const appointment = await appointments_service_1.appointmentsService.getById(id);
            return (0, response_util_1.sendSuccess)(res, 200, appointment, "Appointment fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async list(req, res, next) {
        try {
            const appointments = await appointments_service_1.appointmentsService.list({
                salonId: String(req.query.salon_id || "").trim() || undefined,
                clientId: String(req.query.client_id || "").trim() || undefined,
                date: String(req.query.date || "").trim() || undefined,
                staffId: String(req.query.staff_id || "").trim() || undefined,
                status: String(req.query.status || "").trim() || undefined,
            });
            return (0, response_util_1.sendSuccess)(res, 200, appointments, "Appointments fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async update(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const appointment = await appointments_service_1.appointmentsService.update({
                appointmentId: id, requesterUserId: userId,
                requesterRole: req.user?.role, patch: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 200, appointment, "Appointment updated successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async confirm(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const appointment = await appointments_service_1.appointmentsService.confirm(id);
            return (0, response_util_1.sendSuccess)(res, 200, appointment, "Appointment confirmed successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async start(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const appointment = await appointments_service_1.appointmentsService.start(id);
            return (0, response_util_1.sendSuccess)(res, 200, appointment, "Appointment started successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async cancel(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const appointment = await appointments_service_1.appointmentsService.cancel({
                appointmentId: id, requesterUserId: userId,
                body: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 200, appointment, "Appointment cancelled successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async noShow(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const appointment = await appointments_service_1.appointmentsService.noShow(id);
            return (0, response_util_1.sendSuccess)(res, 200, appointment, "Appointment marked as no-show");
        }
        catch (err) {
            return next(err);
        }
    },
    async checkout(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const { items, discount_amount, tip_amount, tax_amount, payment_method, notes } = req.body;
            const result = await appointments_service_1.appointmentsService.checkout({
                appointmentId: id, requesterUserId: userId, requesterRole: req.user?.role,
                saleItems: items, discount_amount, tip_amount, tax_amount, payment_method, notes,
            });
            return (0, response_util_1.sendSuccess)(res, 200, result, "Appointment checked out and sale created");
        }
        catch (err) {
            return next(err);
        }
    },
    async exportAppointments(req, res, next) {
        try {
            const format = req.query.format === "excel" ? "excel" : "csv";
            const { buffer, contentType, filename } = await appointments_service_1.appointmentsService.exportAppointments({
                salon_id: req.query.salon_id,
                status: req.query.status,
                start_date: req.query.start_date,
                end_date: req.query.end_date,
                format,
            });
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
            res.setHeader("Content-Type", contentType);
            return res.send(buffer);
        }
        catch (err) {
            return next(err);
        }
    },
};
//# sourceMappingURL=appointments.controller.js.map