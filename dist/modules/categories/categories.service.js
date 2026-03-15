"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoriesService = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const salons_repository_1 = require("../salons/salons.repository");
const categories_repository_1 = require("./categories.repository");
exports.categoriesService = {
    async getMySalonId(ownerId) {
        const salon = await salons_repository_1.salonsRepository.findByOwnerId(ownerId);
        if (!salon)
            throw new error_middleware_1.AppError(404, "Salon not found for this user", "NOT_FOUND");
        return salon.id;
    },
    async create(params) {
        const { requesterUserId, body } = params;
        logger_1.default.info("categoriesService.create called", { requesterUserId });
        const salonId = await this.getMySalonId(requesterUserId);
        return categories_repository_1.categoriesRepository.create(salonId, body);
    },
    async listMySalonCategories(params) {
        const { requesterUserId } = params;
        const salonId = await this.getMySalonId(requesterUserId);
        return categories_repository_1.categoriesRepository.listBySalonId(salonId);
    },
    async getByIdForMySalon(params) {
        const { requesterUserId, id } = params;
        const salonId = await this.getMySalonId(requesterUserId);
        const cat = await categories_repository_1.categoriesRepository.findByIdInSalon(id, salonId);
        if (!cat)
            throw new error_middleware_1.AppError(404, "Category not found", "NOT_FOUND");
        return cat;
    },
    async updateForMySalon(params) {
        const { requesterUserId, id, patch } = params;
        const salonId = await this.getMySalonId(requesterUserId);
        const updated = await categories_repository_1.categoriesRepository.update(id, salonId, patch);
        if (!updated)
            throw new error_middleware_1.AppError(404, "Category not found", "NOT_FOUND");
        return updated;
    },
    async removeForMySalon(params) {
        const { requesterUserId, id } = params;
        const salonId = await this.getMySalonId(requesterUserId);
        const deleted = await categories_repository_1.categoriesRepository.remove(id, salonId);
        if (!deleted)
            throw new error_middleware_1.AppError(404, "Category not found", "NOT_FOUND");
        return { id: deleted.id, deleted: true };
    },
};
//# sourceMappingURL=categories.service.js.map