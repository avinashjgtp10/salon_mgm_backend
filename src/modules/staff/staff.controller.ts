import { NextFunction, Request, Response } from "express";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { staffService } from "./staff.service";
import {
    CreateStaffBody,
    CreateStaffLeaveBody,
    CreateStaffScheduleBody,
    UpdateStaffBody,
    UpdateStaffLeaveBody,
    UpdateStaffScheduleBody,
} from "./staff.types";

type AuthRequest = Request & {
    user?: { userId: string; role?: string };
};

export const staffController = {
    // POST /api/v1/staff
    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            logger.info("POST /staff called", {
                requesterUserId: req.user?.userId,
                requesterRole: req.user?.role,
                path: req.originalUrl,
                method: req.method,
            });

            const body = req.body as CreateStaffBody;
            const created = await staffService.create(body);
            return sendSuccess(res, 201, created, "Staff created successfully");
        } catch (err) {
            logger.error("POST /staff error", { err });
            return next(err);
        }
    },

    // GET /api/v1/staff/:id
    async getById(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const id = String(req.params.id || "").trim();
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            logger.info("GET /staff/:id called", { staffId: id });

            const staff = await staffService.getById(id);
            return sendSuccess(res, 200, staff, "Staff fetched successfully");
        } catch (err) {
            logger.error("GET /staff/:id error", { err });
            return next(err);
        }
    },

    // GET /api/v1/staff?salon_id=...
    async listBySalon(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = String(req.query.salon_id || "").trim();
            if (!salonId) throw new AppError(400, "salon_id query is required", "VALIDATION_ERROR");

            logger.info("GET /staff called", { salonId });

            const list = await staffService.listBySalon(salonId);
            return sendSuccess(res, 200, list, "Staff list fetched successfully");
        } catch (err) {
            logger.error("GET /staff error", { err });
            return next(err);
        }
    },

    // PATCH /api/v1/staff/:id
    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const id = String(req.params.id || "").trim();
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            logger.info("PATCH /staff/:id called", { staffId: id });

            const patch = req.body as UpdateStaffBody;
            const updated = await staffService.update({ staffId: id, patch });

            return sendSuccess(res, 200, updated, "Staff updated successfully");
        } catch (err) {
            logger.error("PATCH /staff/:id error", { err });
            return next(err);
        }
    },

    // DELETE /api/v1/staff/:id
    async remove(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const id = String(req.params.id || "").trim();
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            logger.info("DELETE /staff/:id called", { staffId: id });

            await staffService.remove(id);
            return sendSuccess(res, 200, null, "Staff deleted successfully");
        } catch (err) {
            logger.error("DELETE /staff/:id error", { err });
            return next(err);
        }
    },

    // ===== SCHEDULES =====

    // GET /api/v1/staff/:id/schedules
    async getSchedules(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const staffId = String(req.params.id || "").trim();
            if (!staffId) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const schedules = await staffService.getSchedules(staffId);
            return sendSuccess(res, 200, schedules, "Schedules fetched successfully");
        } catch (err) {
            return next(err);
        }
    },

    // POST /api/v1/staff/:id/schedules (upsert by day_of_week)
    async upsertSchedule(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const staffId = String(req.params.id || "").trim();
            if (!staffId) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const body = req.body as Omit<CreateStaffScheduleBody, "staff_id">;
            const created = await staffService.upsertSchedule({ ...body, staff_id: staffId });
            return sendSuccess(res, 201, created, "Schedule saved successfully");
        } catch (err) {
            return next(err);
        }
    },

    // PATCH /api/v1/staff/schedules/:scheduleId
    async updateSchedule(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const scheduleId = String(req.params.scheduleId || "").trim();
            if (!scheduleId) throw new AppError(400, "scheduleId is required", "VALIDATION_ERROR");

            const patch = req.body as UpdateStaffScheduleBody;
            const updated = await staffService.updateSchedule({ scheduleId, patch });
            return sendSuccess(res, 200, updated, "Schedule updated successfully");
        } catch (err) {
            return next(err);
        }
    },

    // DELETE /api/v1/staff/schedules/:scheduleId
    async removeSchedule(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const scheduleId = String(req.params.scheduleId || "").trim();
            if (!scheduleId) throw new AppError(400, "scheduleId is required", "VALIDATION_ERROR");

            await staffService.removeSchedule(scheduleId);
            return sendSuccess(res, 200, null, "Schedule deleted successfully");
        } catch (err) {
            return next(err);
        }
    },

    // ===== LEAVES =====

    // GET /api/v1/staff/:id/leaves
    async listLeaves(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const staffId = String(req.params.id || "").trim();
            if (!staffId) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const leaves = await staffService.listLeaves(staffId);
            return sendSuccess(res, 200, leaves, "Leaves fetched successfully");
        } catch (err) {
            return next(err);
        }
    },

    // POST /api/v1/staff/:id/leaves
    async createLeave(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const staffId = String(req.params.id || "").trim();
            if (!staffId) throw new AppError(400, "id is required", "VALIDATION_ERROR");

            const body = req.body as Omit<CreateStaffLeaveBody, "staff_id">;
            const created = await staffService.createLeave({ ...body, staff_id: staffId });
            return sendSuccess(res, 201, created, "Leave created successfully");
        } catch (err) {
            return next(err);
        }
    },

    // PATCH /api/v1/staff/leaves/:leaveId
    async updateLeave(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const leaveId = String(req.params.leaveId || "").trim();
            if (!leaveId) throw new AppError(400, "leaveId is required", "VALIDATION_ERROR");

            const patch = req.body as UpdateStaffLeaveBody;
            const updated = await staffService.updateLeave({ leaveId, patch });
            return sendSuccess(res, 200, updated, "Leave updated successfully");
        } catch (err) {
            return next(err);
        }
    },

    // DELETE /api/v1/staff/leaves/:leaveId
    async removeLeave(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const leaveId = String(req.params.leaveId || "").trim();
            if (!leaveId) throw new AppError(400, "leaveId is required", "VALIDATION_ERROR");

            await staffService.removeLeave(leaveId);
            return sendSuccess(res, 200, null, "Leave deleted successfully");
        } catch (err) {
            return next(err);
        }
    },
};
