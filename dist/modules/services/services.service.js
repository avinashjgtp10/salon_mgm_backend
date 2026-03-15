"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bundlesService = exports.servicesService = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const services_repository_1 = require("./services.repository");
exports.servicesService = {
    async list(query) {
        return services_repository_1.servicesRepository.list(query);
    },
    async create(params) {
        const { requesterUserId, requesterRole, body } = params;
        logger_1.default.info("servicesService.create", { requesterUserId, requesterRole });
        const created = await services_repository_1.servicesRepository.create(body);
        if (body.staff_ids?.length) {
            await services_repository_1.servicesRepository.replaceStaff(created.id, body.staff_ids);
        }
        logger_1.default.info("servicesService.create success", { serviceId: created.id });
        return created;
    },
    async getById(serviceId) {
        const detail = await services_repository_1.servicesRepository.getDetailById(serviceId);
        if (!detail)
            throw new error_middleware_1.AppError(404, "Service not found", "NOT_FOUND");
        return detail;
    },
    async update(params) {
        const { serviceId, requesterUserId, requesterRole, patch } = params;
        logger_1.default.info("servicesService.update", { serviceId, requesterUserId, requesterRole });
        const existing = await services_repository_1.servicesRepository.findById(serviceId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Service not found", "NOT_FOUND");
        const staffIds = patch.staff_ids ??
            patch.team_member_ids;
        const updated = await services_repository_1.servicesRepository.update(serviceId, patch);
        if (staffIds !== undefined) {
            await services_repository_1.servicesRepository.replaceStaff(serviceId, staffIds);
        }
        logger_1.default.info("servicesService.update success", { serviceId });
        return updated;
    },
    async remove(serviceId) {
        const existing = await services_repository_1.servicesRepository.findById(serviceId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Service not found", "NOT_FOUND");
        await services_repository_1.servicesRepository.delete(serviceId);
    },
    async listAddOnGroups(serviceId) {
        const existing = await services_repository_1.servicesRepository.findById(serviceId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Service not found", "NOT_FOUND");
        return services_repository_1.servicesRepository.listAddOnGroupsWithOptions(serviceId);
    },
    async createAddOnGroup(params) {
        const existing = await services_repository_1.servicesRepository.findById(params.serviceId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Service not found", "NOT_FOUND");
        return services_repository_1.servicesRepository.createAddOnGroup(params.serviceId, params.body);
    },
    async updateAddOnGroup(params) {
        const existing = await services_repository_1.servicesRepository.findById(params.serviceId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Service not found", "NOT_FOUND");
        const groups = await services_repository_1.servicesRepository.listAddOnGroupsWithOptions(params.serviceId);
        if (!groups.some((g) => g.id === params.groupId))
            throw new error_middleware_1.AppError(404, "Add-on group not found for this service", "NOT_FOUND");
        return services_repository_1.servicesRepository.updateAddOnGroup(params.groupId, params.patch);
    },
    async deleteAddOnGroup(params) {
        const existing = await services_repository_1.servicesRepository.findById(params.serviceId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Service not found", "NOT_FOUND");
        const groups = await services_repository_1.servicesRepository.listAddOnGroupsWithOptions(params.serviceId);
        if (!groups.some((g) => g.id === params.groupId))
            throw new error_middleware_1.AppError(404, "Add-on group not found for this service", "NOT_FOUND");
        await services_repository_1.servicesRepository.deleteAddOnGroup(params.groupId);
    },
    async createAddOnOption(params) {
        const existing = await services_repository_1.servicesRepository.findById(params.serviceId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Service not found", "NOT_FOUND");
        const groups = await services_repository_1.servicesRepository.listAddOnGroupsWithOptions(params.serviceId);
        if (!groups.some((g) => g.id === params.groupId))
            throw new error_middleware_1.AppError(404, "Add-on group not found for this service", "NOT_FOUND");
        return services_repository_1.servicesRepository.createAddOnOption(params.groupId, params.body);
    },
    async updateAddOnOption(params) {
        const existing = await services_repository_1.servicesRepository.findById(params.serviceId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Service not found", "NOT_FOUND");
        const groups = await services_repository_1.servicesRepository.listAddOnGroupsWithOptions(params.serviceId);
        const group = groups.find((g) => g.id === params.groupId);
        if (!group)
            throw new error_middleware_1.AppError(404, "Add-on group not found for this service", "NOT_FOUND");
        if (!group.options.some((o) => o.id === params.optionId))
            throw new error_middleware_1.AppError(404, "Add-on option not found for this group", "NOT_FOUND");
        return services_repository_1.servicesRepository.updateAddOnOption(params.optionId, params.patch);
    },
    async deleteAddOnOption(params) {
        const existing = await services_repository_1.servicesRepository.findById(params.serviceId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Service not found", "NOT_FOUND");
        const groups = await services_repository_1.servicesRepository.listAddOnGroupsWithOptions(params.serviceId);
        const group = groups.find((g) => g.id === params.groupId);
        if (!group)
            throw new error_middleware_1.AppError(404, "Add-on group not found for this service", "NOT_FOUND");
        if (!group.options.some((o) => o.id === params.optionId))
            throw new error_middleware_1.AppError(404, "Add-on option not found for this group", "NOT_FOUND");
        await services_repository_1.servicesRepository.deleteAddOnOption(params.optionId);
    },
};
exports.bundlesService = {
    async list(query) {
        return services_repository_1.bundlesRepository.list(query);
    },
    async create(params) {
        const { requesterUserId, requesterRole, body } = params;
        logger_1.default.info("bundlesService.create", { requesterUserId, requesterRole });
        const created = await services_repository_1.bundlesRepository.create(body);
        if (body.service_ids?.length) {
            await services_repository_1.bundlesRepository.replaceServices(created.id, body.service_ids);
        }
        logger_1.default.info("bundlesService.create success", { bundleId: created.id });
        return services_repository_1.bundlesRepository.getDetailById(created.id);
    },
    async getById(bundleId) {
        const detail = await services_repository_1.bundlesRepository.getDetailById(bundleId);
        if (!detail)
            throw new error_middleware_1.AppError(404, "Bundle not found", "NOT_FOUND");
        return detail;
    },
    async update(params) {
        const { bundleId, requesterUserId, requesterRole, patch } = params;
        logger_1.default.info("bundlesService.update", { bundleId, requesterUserId, requesterRole });
        const existing = await services_repository_1.bundlesRepository.findById(bundleId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Bundle not found", "NOT_FOUND");
        await services_repository_1.bundlesRepository.update(bundleId, patch);
        if (patch.service_ids !== undefined) {
            await services_repository_1.bundlesRepository.replaceServices(bundleId, patch.service_ids);
        }
        logger_1.default.info("bundlesService.update success", { bundleId });
        return services_repository_1.bundlesRepository.getDetailById(bundleId);
    },
    async remove(bundleId) {
        const existing = await services_repository_1.bundlesRepository.findById(bundleId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Bundle not found", "NOT_FOUND");
        await services_repository_1.bundlesRepository.delete(bundleId);
    },
};
//# sourceMappingURL=services.service.js.map