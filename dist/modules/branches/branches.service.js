"use strict";
// src/modules/branches/branches.service.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.branchesService = void 0;
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const branches_repository_1 = require("./branches.repository");
exports.branchesService = {
    // --------- BRANCH ----------
    async createBranch(salonId, body) {
        logger_1.default.info("branchesService.createBranch called", { salonId });
        if (body.is_main === true) {
            await branches_repository_1.branchesRepository.unsetMainBranch(salonId);
        }
        try {
            return await branches_repository_1.branchesRepository.create(salonId, body);
        }
        catch (e) {
            if (e?.code === "23505") {
                throw new error_middleware_1.AppError(409, "Main branch already exists for this salon", "MAIN_BRANCH_EXISTS");
            }
            throw e;
        }
    },
    async listBranchesBySalon(salonId) {
        return branches_repository_1.branchesRepository.listBySalonId(salonId);
    },
    async getBranchById(id) {
        const b = await branches_repository_1.branchesRepository.findById(id);
        if (!b)
            throw new error_middleware_1.AppError(404, "Branch not found", "NOT_FOUND");
        return b;
    },
    async updateBranch(branchId, patch) {
        const existing = await branches_repository_1.branchesRepository.findById(branchId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Branch not found", "NOT_FOUND");
        if (patch.is_main === true) {
            await branches_repository_1.branchesRepository.unsetMainBranch(existing.salon_id);
        }
        try {
            return await branches_repository_1.branchesRepository.update(branchId, patch);
        }
        catch (e) {
            if (e?.code === "23505") {
                throw new error_middleware_1.AppError(409, "Main branch already exists for this salon", "MAIN_BRANCH_EXISTS");
            }
            throw e;
        }
    },
    // --------- TIMINGS ----------
    async getTimings(branchId) {
        const branch = await branches_repository_1.branchesRepository.findById(branchId);
        if (!branch)
            throw new error_middleware_1.AppError(404, "Branch not found", "NOT_FOUND");
        return branches_repository_1.branchesRepository.listTimings(branchId);
    },
    async setTimings(branchId, days) {
        const branch = await branches_repository_1.branchesRepository.findById(branchId);
        if (!branch)
            throw new error_middleware_1.AppError(404, "Branch not found", "NOT_FOUND");
        return branches_repository_1.branchesRepository.upsertTimings(branchId, days);
    },
    async replaceTimings(branchId, days) {
        const branch = await branches_repository_1.branchesRepository.findById(branchId);
        if (!branch)
            throw new error_middleware_1.AppError(404, "Branch not found", "NOT_FOUND");
        return branches_repository_1.branchesRepository.replaceTimings(branchId, days);
    },
    // --------- HOLIDAYS ----------
    async createHoliday(branchId, holidayDate, reason) {
        const branch = await branches_repository_1.branchesRepository.findById(branchId);
        if (!branch)
            throw new error_middleware_1.AppError(404, "Branch not found", "NOT_FOUND");
        return branches_repository_1.branchesRepository.createHoliday(branchId, holidayDate, reason);
    },
    async listHolidays(branchId, from, to) {
        const branch = await branches_repository_1.branchesRepository.findById(branchId);
        if (!branch)
            throw new error_middleware_1.AppError(404, "Branch not found", "NOT_FOUND");
        return branches_repository_1.branchesRepository.listHolidays(branchId, from, to);
    },
    async deleteHoliday(holidayId) {
        const existing = await branches_repository_1.branchesRepository.findHolidayById(holidayId);
        if (!existing)
            throw new error_middleware_1.AppError(404, "Holiday not found", "NOT_FOUND");
        await branches_repository_1.branchesRepository.deleteHolidayById(holidayId);
    },
};
//# sourceMappingURL=branches.service.js.map