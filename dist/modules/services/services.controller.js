"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bundlesController = exports.servicesController = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const services_service_1 = require("./services.service");
// ─── Services ─────────────────────────────────────────────────────────────────
exports.servicesController = {
    async list(req, res, next) {
        try {
            const q = req.query;
            const query = {
                category_id: q.category_id,
                search: q.search,
                status: q.status,
                type: q.type,
                staff_id: q.staff_id,
                online_booking: q.online_booking,
                commissions: q.commissions,
                resource_requirements: q.resource_requirements,
                page: q.page ? Number(q.page) : undefined,
                limit: q.limit ? Number(q.limit) : undefined,
            };
            logger_1.default.info("GET /services", { query });
            const result = await services_service_1.servicesService.list(query);
            return (0, response_util_1.sendSuccess)(res, 200, result, "Services list fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async create(req, res, next) {
        try {
            const userId = req.user?.userId;
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            logger_1.default.info("POST /services", { userId });
            const created = await services_service_1.servicesService.create({
                requesterUserId: userId,
                requesterRole: req.user?.role,
                body: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 201, created, "Service created successfully");
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
            const service = await services_service_1.servicesService.getById(id);
            return (0, response_util_1.sendSuccess)(res, 200, service, "Service fetched successfully");
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
            const updated = await services_service_1.servicesService.update({
                serviceId: id,
                requesterUserId: userId,
                requesterRole: req.user?.role,
                patch: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 200, updated, "Service updated successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async remove(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            await services_service_1.servicesService.remove(id);
            return res.status(204).send();
        }
        catch (err) {
            return next(err);
        }
    },
    async listAddOnGroups(req, res, next) {
        try {
            const id = String(req.params.id || "").trim();
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const groups = await services_service_1.servicesService.listAddOnGroups(id);
            return (0, response_util_1.sendSuccess)(res, 200, groups, "Add-on groups fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async createAddOnGroup(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            const created = await services_service_1.servicesService.createAddOnGroup({
                serviceId: id,
                requesterUserId: userId,
                requesterRole: req.user?.role,
                body: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 201, created, "Add-on group created successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async updateAddOnGroup(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            const groupId = String(req.params.groupId || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            if (!groupId)
                throw new error_middleware_1.AppError(400, "groupId is required", "VALIDATION_ERROR");
            const updated = await services_service_1.servicesService.updateAddOnGroup({
                serviceId: id,
                groupId,
                requesterUserId: userId,
                requesterRole: req.user?.role,
                patch: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 200, updated, "Add-on group updated successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async deleteAddOnGroup(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            const groupId = String(req.params.groupId || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            if (!groupId)
                throw new error_middleware_1.AppError(400, "groupId is required", "VALIDATION_ERROR");
            await services_service_1.servicesService.deleteAddOnGroup({ serviceId: id, groupId });
            return res.status(204).send();
        }
        catch (err) {
            return next(err);
        }
    },
    async createAddOnOption(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            const groupId = String(req.params.groupId || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            if (!groupId)
                throw new error_middleware_1.AppError(400, "groupId is required", "VALIDATION_ERROR");
            const created = await services_service_1.servicesService.createAddOnOption({
                serviceId: id,
                groupId,
                requesterUserId: userId,
                requesterRole: req.user?.role,
                body: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 201, created, "Add-on option created successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async updateAddOnOption(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            const groupId = String(req.params.groupId || "").trim();
            const optionId = String(req.params.optionId || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            if (!groupId)
                throw new error_middleware_1.AppError(400, "groupId is required", "VALIDATION_ERROR");
            if (!optionId)
                throw new error_middleware_1.AppError(400, "optionId is required", "VALIDATION_ERROR");
            const updated = await services_service_1.servicesService.updateAddOnOption({
                serviceId: id,
                groupId,
                optionId,
                requesterUserId: userId,
                requesterRole: req.user?.role,
                patch: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 200, updated, "Add-on option updated successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async deleteAddOnOption(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            const groupId = String(req.params.groupId || "").trim();
            const optionId = String(req.params.optionId || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            if (!groupId)
                throw new error_middleware_1.AppError(400, "groupId is required", "VALIDATION_ERROR");
            if (!optionId)
                throw new error_middleware_1.AppError(400, "optionId is required", "VALIDATION_ERROR");
            await services_service_1.servicesService.deleteAddOnOption({ serviceId: id, groupId, optionId });
            return res.status(204).send();
        }
        catch (err) {
            return next(err);
        }
    },
};
// ─── Bundles ──────────────────────────────────────────────────────────────────
exports.bundlesController = {
    async list(req, res, next) {
        try {
            const q = req.query;
            const query = {
                category_id: q.category_id,
                search: q.search,
                status: q.status,
                team_member_id: q.team_member_id,
                online_booking: q.online_booking,
                commissions: q.commissions,
                resource_requirements: q.resource_requirements,
                available_for: q.available_for,
                page: q.page ? Number(q.page) : undefined,
                limit: q.limit ? Number(q.limit) : undefined,
            };
            logger_1.default.info("GET /bundles", { query });
            const result = await services_service_1.bundlesService.list(query);
            return (0, response_util_1.sendSuccess)(res, 200, result, "Bundles list fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async create(req, res, next) {
        try {
            const userId = req.user?.userId;
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            logger_1.default.info("POST /bundles", { userId });
            const created = await services_service_1.bundlesService.create({
                requesterUserId: userId,
                requesterRole: req.user?.role,
                body: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 201, created, "Bundle created successfully");
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
            const bundle = await services_service_1.bundlesService.getById(id);
            return (0, response_util_1.sendSuccess)(res, 200, bundle, "Bundle fetched successfully");
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
            const updated = await services_service_1.bundlesService.update({
                bundleId: id,
                requesterUserId: userId,
                requesterRole: req.user?.role,
                patch: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 200, updated, "Bundle updated successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async remove(req, res, next) {
        try {
            const userId = req.user?.userId;
            const id = String(req.params.id || "").trim();
            if (!userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            if (!id)
                throw new error_middleware_1.AppError(400, "id is required", "VALIDATION_ERROR");
            await services_service_1.bundlesService.remove(id);
            return res.status(204).send();
        }
        catch (err) {
            return next(err);
        }
    },
};
//# sourceMappingURL=services.controller.js.map