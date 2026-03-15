"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.calendarController = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const calendar_service_1 = require("./calendar.service");
exports.calendarController = {
    // POST /api/v1/appointments
    async create(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            logger_1.default.info("POST /appointments called", { userId, role, path: req.originalUrl, method: req.method });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const appointment = await calendar_service_1.calendarService.create({
                requesterUserId: userId,
                requesterRole: role,
                body: req.body,
            });
            (0, response_util_1.sendSuccess)(res, 201, appointment, "Appointment created successfully");
        }
        catch (err) {
            logger_1.default.error("POST /appointments error", { err });
            next(err);
        }
    },
    // GET /api/v1/appointments/:id
    async getById(req, res, next) {
        try {
            const id = String(req.params.id || "").trim();
            logger_1.default.info("GET /appointments/:id called", { id, path: req.originalUrl, method: req.method });
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const appointment = await calendar_service_1.calendarService.getById(id);
            (0, response_util_1.sendSuccess)(res, 200, appointment, "Appointment fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /appointments/:id error", { err });
            next(err);
        }
    },
    // GET /api/v1/appointments
    async list(req, res, next) {
        try {
            logger_1.default.info("GET /appointments called", {
                requesterUserId: req.user?.userId,
                query: req.query,
                path: req.originalUrl,
                method: req.method,
            });
            const filters = {
                salon_id: req.query.salon_id,
                branch_id: req.query.branch_id,
                client_id: req.query.client_id,
                staff_id: req.query.staff_id,
                status: req.query.status,
                date: req.query.date,
                from: req.query.from,
                to: req.query.to,
                page: req.query.page ? parseInt(req.query.page, 10) : 1,
                limit: req.query.limit ? parseInt(req.query.limit, 10) : 50,
            };
            const result = await calendar_service_1.calendarService.list(filters);
            (0, response_util_1.sendSuccess)(res, 200, result, "Appointments fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /appointments error", { err });
            next(err);
        }
    },
    // PATCH /api/v1/appointments/:id
    async update(req, res, next) {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const id = String(req.params.id || "").trim();
            logger_1.default.info("PATCH /appointments/:id called", { id, userId, role, path: req.originalUrl, method: req.method });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await calendar_service_1.calendarService.update({
                appointmentId: id,
                requesterUserId: userId,
                requesterRole: role,
                patch: req.body,
            });
            (0, response_util_1.sendSuccess)(res, 200, updated, "Appointment updated successfully");
        }
        catch (err) {
            logger_1.default.error("PATCH /appointments/:id error", { err });
            next(err);
        }
    },
    // POST /api/v1/appointments/:id/confirm
    async confirm(req, res, next) {
        try {
            const id = String(req.params.id || "").trim();
            logger_1.default.info("POST /appointments/:id/confirm called", { id, path: req.originalUrl });
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await calendar_service_1.calendarService.confirm(id);
            (0, response_util_1.sendSuccess)(res, 200, updated, "Appointment confirmed successfully");
        }
        catch (err) {
            logger_1.default.error("POST /appointments/:id/confirm error", { err });
            next(err);
        }
    },
    // POST /api/v1/appointments/:id/start
    async start(req, res, next) {
        try {
            const id = String(req.params.id || "").trim();
            logger_1.default.info("POST /appointments/:id/start called", { id, path: req.originalUrl });
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await calendar_service_1.calendarService.start(id);
            (0, response_util_1.sendSuccess)(res, 200, updated, "Appointment started successfully");
        }
        catch (err) {
            logger_1.default.error("POST /appointments/:id/start error", { err });
            next(err);
        }
    },
    // POST /api/v1/appointments/:id/cancel
    async cancel(req, res, next) {
        try {
            const id = String(req.params.id || "").trim();
            logger_1.default.info("POST /appointments/:id/cancel called", { id, path: req.originalUrl });
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await calendar_service_1.calendarService.cancel(id, req.body);
            (0, response_util_1.sendSuccess)(res, 200, updated, "Appointment cancelled successfully");
        }
        catch (err) {
            logger_1.default.error("POST /appointments/:id/cancel error", { err });
            next(err);
        }
    },
    // POST /api/v1/appointments/:id/no-show
    async noShow(req, res, next) {
        try {
            const id = String(req.params.id || "").trim();
            logger_1.default.info("POST /appointments/:id/no-show called", { id, path: req.originalUrl });
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const updated = await calendar_service_1.calendarService.noShow(id);
            (0, response_util_1.sendSuccess)(res, 200, updated, "Appointment marked as no-show");
        }
        catch (err) {
            logger_1.default.error("POST /appointments/:id/no-show error", { err });
            next(err);
        }
    },
    // POST /api/v1/appointments/:id/checkout
    async checkout(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            logger_1.default.info("POST /appointments/:id/checkout called", { id, userId, path: req.originalUrl, method: req.method });
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const result = await calendar_service_1.calendarService.checkout({
                appointmentId: id,
                requesterUserId: userId,
                body: req.body,
            });
            (0, response_util_1.sendSuccess)(res, 200, result, "Checkout completed successfully");
        }
        catch (err) {
            logger_1.default.error("POST /appointments/:id/checkout error", { err });
            next(err);
        }
    },
};
//# sourceMappingURL=calendar.controller.js.map