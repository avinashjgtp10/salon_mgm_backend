"use strict";
// src/modules/branches/branches.controller.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.branchesController = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const branches_service_1 = require("./branches.service");
const salons_service_1 = require("../salons/salons.service");
exports.branchesController = {
    // ---------- BRANCH ----------
    async create(req, res, next) {
        try {
            if (!req.user?.userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const body = req.body;
            const salon = await salons_service_1.salonsService.mySalon(req.user.userId);
            const created = await branches_service_1.branchesService.createBranch(salon.id, body);
            return (0, response_util_1.sendSuccess)(res, 201, created, "Branch created successfully");
        }
        catch (err) {
            logger_1.default.error("POST /branches error", { err });
            return next(err);
        }
    },
    async listBySalon(req, res, next) {
        try {
            if (!req.user?.userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const salonId = String(req.params.salonId || "").trim();
            const list = await branches_service_1.branchesService.listBranchesBySalon(salonId);
            return (0, response_util_1.sendSuccess)(res, 200, list, "Branches fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /branches/by-salon/:salonId error", { err });
            return next(err);
        }
    },
    async getById(req, res, next) {
        try {
            if (!req.user?.userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const id = String(req.params.id || "").trim();
            const branch = await branches_service_1.branchesService.getBranchById(id);
            return (0, response_util_1.sendSuccess)(res, 200, branch, "Branch fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /branches/:id error", { err });
            return next(err);
        }
    },
    async update(req, res, next) {
        try {
            if (!req.user?.userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const id = String(req.params.id || "").trim();
            const patch = req.body;
            const updated = await branches_service_1.branchesService.updateBranch(id, patch);
            return (0, response_util_1.sendSuccess)(res, 200, updated, "Branch updated successfully");
        }
        catch (err) {
            logger_1.default.error("PATCH /branches/:id error", { err });
            return next(err);
        }
    },
    // ---------- TIMINGS ----------
    async setTimings(req, res, next) {
        try {
            if (!req.user?.userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const branchId = String(req.params.id || "").trim();
            const days = (req.body?.days ?? []);
            const saved = await branches_service_1.branchesService.setTimings(branchId, days);
            return (0, response_util_1.sendSuccess)(res, 200, saved, "Branch timings saved successfully");
        }
        catch (err) {
            logger_1.default.error("POST /branches/:id/timings error", { err });
            return next(err);
        }
    },
    async getTimings(req, res, next) {
        try {
            if (!req.user?.userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const branchId = String(req.params.id || "").trim();
            const timings = await branches_service_1.branchesService.getTimings(branchId);
            return (0, response_util_1.sendSuccess)(res, 200, timings, "Branch timings fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /branches/:id/timings error", { err });
            return next(err);
        }
    },
    async replaceTimings(req, res, next) {
        try {
            if (!req.user?.userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const branchId = String(req.params.id || "").trim();
            const days = (req.body?.days ?? []);
            const saved = await branches_service_1.branchesService.replaceTimings(branchId, days);
            return (0, response_util_1.sendSuccess)(res, 200, saved, "Branch timings replaced successfully");
        }
        catch (err) {
            logger_1.default.error("PUT /branches/:id/timings error", { err });
            return next(err);
        }
    },
    // ---------- HOLIDAYS ----------
    async createHoliday(req, res, next) {
        try {
            if (!req.user?.userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const branchId = String(req.params.id || "").trim();
            const body = req.body;
            const created = await branches_service_1.branchesService.createHoliday(branchId, body.holiday_date, body.reason);
            return (0, response_util_1.sendSuccess)(res, 201, created, "Holiday created successfully");
        }
        catch (err) {
            logger_1.default.error("POST /branches/:id/holidays error", { err });
            return next(err);
        }
    },
    async listHolidays(req, res, next) {
        try {
            if (!req.user?.userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const branchId = String(req.params.id || "").trim();
            const from = req.query.from ? String(req.query.from) : undefined;
            const to = req.query.to ? String(req.query.to) : undefined;
            const holidays = await branches_service_1.branchesService.listHolidays(branchId, from, to);
            return (0, response_util_1.sendSuccess)(res, 200, holidays, "Holidays fetched successfully");
        }
        catch (err) {
            logger_1.default.error("GET /branches/:id/holidays error", { err });
            return next(err);
        }
    },
    async deleteHoliday(req, res, next) {
        try {
            if (!req.user?.userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const holidayId = String(req.params.holidayId || "").trim();
            await branches_service_1.branchesService.deleteHoliday(holidayId);
            return (0, response_util_1.sendSuccess)(res, 200, { deleted: true }, "Holiday deleted successfully");
        }
        catch (err) {
            logger_1.default.error("DELETE /holidays/:holidayId error", { err });
            return next(err);
        }
    },
};
//# sourceMappingURL=branches.controller.js.map