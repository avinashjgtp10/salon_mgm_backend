// src/modules/branches/branches.service.ts

import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { branchesRepository } from "./branches.repository";
import { Branch, BranchHoliday, BranchTiming, CreateBranchBody, TimingDayInput, UpdateBranchBody } from "./branches.types";

export const branchesService = {
    // --------- BRANCH ----------
    async createBranch(salonId: string, body: CreateBranchBody): Promise<Branch> {
        logger.info("branchesService.createBranch called", { salonId });

        if (body.is_main === true) {
            await branchesRepository.unsetMainBranch(salonId);
        }

        try {
            return await branchesRepository.create(salonId, body);
        } catch (e: any) {
            if (e?.code === "23505") {
                throw new AppError(409, "Main branch already exists for this salon", "MAIN_BRANCH_EXISTS");
            }
            throw e;
        }
    },

    async listBranchesBySalon(salonId: string): Promise<Branch[]> {
        return branchesRepository.listBySalonId(salonId);
    },

    async getBranchById(id: string): Promise<Branch> {
        const b = await branchesRepository.findById(id);
        if (!b) throw new AppError(404, "Branch not found", "NOT_FOUND");
        return b;
    },

    async updateBranch(branchId: string, patch: UpdateBranchBody): Promise<Branch> {
        const existing = await branchesRepository.findById(branchId);
        if (!existing) throw new AppError(404, "Branch not found", "NOT_FOUND");

        if (patch.is_main === true) {
            await branchesRepository.unsetMainBranch(existing.salon_id);
        }

        try {
            return await branchesRepository.update(branchId, patch);
        } catch (e: any) {
            if (e?.code === "23505") {
                throw new AppError(409, "Main branch already exists for this salon", "MAIN_BRANCH_EXISTS");
            }
            throw e;
        }
    },

    // --------- TIMINGS ----------
    async getTimings(branchId: string): Promise<BranchTiming[]> {
        const branch = await branchesRepository.findById(branchId);
        if (!branch) throw new AppError(404, "Branch not found", "NOT_FOUND");
        return branchesRepository.listTimings(branchId);
    },

    async setTimings(branchId: string, days: TimingDayInput[]): Promise<BranchTiming[]> {
        const branch = await branchesRepository.findById(branchId);
        if (!branch) throw new AppError(404, "Branch not found", "NOT_FOUND");

        return branchesRepository.upsertTimings(branchId, days);
    },

    async replaceTimings(branchId: string, days: TimingDayInput[]): Promise<BranchTiming[]> {
        const branch = await branchesRepository.findById(branchId);
        if (!branch) throw new AppError(404, "Branch not found", "NOT_FOUND");

        return branchesRepository.replaceTimings(branchId, days);
    },

    // --------- HOLIDAYS ----------
    async createHoliday(branchId: string, holidayDate: string, reason?: string): Promise<BranchHoliday> {
        const branch = await branchesRepository.findById(branchId);
        if (!branch) throw new AppError(404, "Branch not found", "NOT_FOUND");

        return branchesRepository.createHoliday(branchId, holidayDate, reason);
    },

    async listHolidays(branchId: string, from?: string, to?: string): Promise<BranchHoliday[]> {
        const branch = await branchesRepository.findById(branchId);
        if (!branch) throw new AppError(404, "Branch not found", "NOT_FOUND");

        return branchesRepository.listHolidays(branchId, from, to);
    },

    async deleteHoliday(holidayId: string): Promise<void> {
        const existing = await branchesRepository.findHolidayById(holidayId);
        if (!existing) throw new AppError(404, "Holiday not found", "NOT_FOUND");

        await branchesRepository.deleteHolidayById(holidayId);
    },
};
