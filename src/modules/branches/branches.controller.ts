// src/modules/branches/branches.controller.ts

import { Request, Response, NextFunction } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { branchesService } from "./branches.service";
import { salonsService } from "../salons/salons.service";
import { CreateBranchBody, CreateHolidayBody, TimingDayInput, UpdateBranchBody } from "./branches.types";

type AuthRequest = Request & {
    user?: { userId: string; role?: string };
};

export const branchesController = {
    // ---------- BRANCH ----------
    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const body = req.body as CreateBranchBody;
            const salon = await salonsService.mySalon(req.user.userId);
            const created = await branchesService.createBranch(salon.id, body);

            return sendSuccess(res, 201, created, "Branch created successfully");
        } catch (err) {
            logger.error("POST /branches error", { err });
            return next(err);
        }
    },

    async listBySalon(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const salonId = String(req.params.salonId || "").trim();
            const list = await branchesService.listBranchesBySalon(salonId);

            return sendSuccess(res, 200, list, "Branches fetched successfully");
        } catch (err) {
            logger.error("GET /branches/by-salon/:salonId error", { err });
            return next(err);
        }
    },

    async getById(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const id = String(req.params.id || "").trim();
            const branch = await branchesService.getBranchById(id);

            return sendSuccess(res, 200, branch, "Branch fetched successfully");
        } catch (err) {
            logger.error("GET /branches/:id error", { err });
            return next(err);
        }
    },

    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const id = String(req.params.id || "").trim();
            const patch = req.body as UpdateBranchBody;

            const updated = await branchesService.updateBranch(id, patch);

            return sendSuccess(res, 200, updated, "Branch updated successfully");
        } catch (err) {
            logger.error("PATCH /branches/:id error", { err });
            return next(err);
        }
    },

    // ---------- TIMINGS ----------
    async setTimings(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const branchId = String(req.params.id || "").trim();
            const days = (req.body?.days ?? []) as TimingDayInput[];

            const saved = await branchesService.setTimings(branchId, days);

            return sendSuccess(res, 200, saved, "Branch timings saved successfully");
        } catch (err) {
            logger.error("POST /branches/:id/timings error", { err });
            return next(err);
        }
    },

    async getTimings(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const branchId = String(req.params.id || "").trim();
            const timings = await branchesService.getTimings(branchId);

            return sendSuccess(res, 200, timings, "Branch timings fetched successfully");
        } catch (err) {
            logger.error("GET /branches/:id/timings error", { err });
            return next(err);
        }
    },

    async replaceTimings(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const branchId = String(req.params.id || "").trim();
            const days = (req.body?.days ?? []) as TimingDayInput[];

            const saved = await branchesService.replaceTimings(branchId, days);

            return sendSuccess(res, 200, saved, "Branch timings replaced successfully");
        } catch (err) {
            logger.error("PUT /branches/:id/timings error", { err });
            return next(err);
        }
    },

    // ---------- HOLIDAYS ----------
    async createHoliday(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const branchId = String(req.params.id || "").trim();
            const body = req.body as CreateHolidayBody;

            const created = await branchesService.createHoliday(branchId, body.holiday_date, body.reason);

            return sendSuccess(res, 201, created, "Holiday created successfully");
        } catch (err) {
            logger.error("POST /branches/:id/holidays error", { err });
            return next(err);
        }
    },

    async listHolidays(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const branchId = String(req.params.id || "").trim();
            const from = req.query.from ? String(req.query.from) : undefined;
            const to = req.query.to ? String(req.query.to) : undefined;

            const holidays = await branchesService.listHolidays(branchId, from, to);

            return sendSuccess(res, 200, holidays, "Holidays fetched successfully");
        } catch (err) {
            logger.error("GET /branches/:id/holidays error", { err });
            return next(err);
        }
    },

    async deleteHoliday(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const holidayId = String(req.params.holidayId || "").trim();
            await branchesService.deleteHoliday(holidayId);

            return sendSuccess(res, 200, { deleted: true }, "Holiday deleted successfully");
        } catch (err) {
            logger.error("DELETE /holidays/:holidayId error", { err });
            return next(err);
        }
    },
};
