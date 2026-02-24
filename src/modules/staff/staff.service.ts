import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { staffRepository } from "./staff.repository";
import {
    CreateStaffBody,
    CreateStaffLeaveBody,
    CreateStaffScheduleBody,
    Staff,
    StaffLeave,
    StaffSchedule,
    UpdateStaffBody,
    UpdateStaffLeaveBody,
    UpdateStaffScheduleBody,
} from "./staff.types";

export const staffService = {
    // -------- STAFF --------
    async create(body: CreateStaffBody): Promise<Staff> {
        logger.info("staffService.create called", { salonId: body.salon_id, userId: body.user_id });

        // basic duplicate check: one user in one salon (optional but useful)
        // If you want this rule strictly, add a DB UNIQUE(user_id, salon_id)
        // Here we just do a soft-check:
        const existing = await staffRepository.listBySalon(body.salon_id);
        const found = existing.find((s) => s.user_id === body.user_id);
        if (found) {
            throw new AppError(409, "Staff already exists for this user in this salon", "STAFF_EXISTS");
        }

        // normalize commission_value if string
        const normalized: CreateStaffBody = {
            ...body,
            commission_value:
                typeof body.commission_value === "string" ? Number(body.commission_value) : body.commission_value,
        };

        return staffRepository.create(normalized);
    },

    async getById(id: string): Promise<Staff> {
        const staff = await staffRepository.findById(id);
        if (!staff) throw new AppError(404, "Staff not found", "NOT_FOUND");
        return staff;
    },

    async listBySalon(salonId: string): Promise<Staff[]> {
        return staffRepository.listBySalon(salonId);
    },

    async update(params: { staffId: string; patch: UpdateStaffBody }): Promise<Staff> {
        const { staffId, patch } = params;

        logger.info("staffService.update called", { staffId });

        const existing = await staffRepository.findById(staffId);
        if (!existing) throw new AppError(404, "Staff not found", "NOT_FOUND");

        if (patch.commission_value !== undefined && typeof patch.commission_value === "string") {
            (patch as any).commission_value = Number(patch.commission_value);
        }

        return staffRepository.update(staffId, patch);
    },

    async remove(staffId: string): Promise<void> {
        const existing = await staffRepository.findById(staffId);
        if (!existing) throw new AppError(404, "Staff not found", "NOT_FOUND");
        await staffRepository.remove(staffId);
    },

    // -------- SCHEDULES --------
    async getSchedules(staffId: string): Promise<StaffSchedule[]> {
        await this.getById(staffId); // ensure staff exists
        return staffRepository.getSchedules(staffId);
    },

    async upsertSchedule(body: CreateStaffScheduleBody): Promise<StaffSchedule> {
        await this.getById(body.staff_id);
        return staffRepository.upsertSchedule(body);
    },

    async updateSchedule(params: { scheduleId: string; patch: UpdateStaffScheduleBody }): Promise<StaffSchedule> {
        logger.info("staffService.updateSchedule called", { scheduleId: params.scheduleId });
        return staffRepository.updateSchedule(params.scheduleId, params.patch);
    },

    async removeSchedule(scheduleId: string): Promise<void> {
        await staffRepository.removeSchedule(scheduleId);
    },

    // -------- LEAVES --------
    async listLeaves(staffId: string): Promise<StaffLeave[]> {
        await this.getById(staffId);
        return staffRepository.listLeaves(staffId);
    },

    async createLeave(body: CreateStaffLeaveBody): Promise<StaffLeave> {
        await this.getById(body.staff_id);
        return staffRepository.createLeave(body);
    },

    async updateLeave(params: { leaveId: string; patch: UpdateStaffLeaveBody }): Promise<StaffLeave> {
        logger.info("staffService.updateLeave called", { leaveId: params.leaveId });
        return staffRepository.updateLeave(params.leaveId, params.patch);
    },

    async removeLeave(leaveId: string): Promise<void> {
        await staffRepository.removeLeave(leaveId);
    },
};
