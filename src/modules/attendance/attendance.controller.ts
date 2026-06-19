import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { attendanceService } from "./attendance.service";
import {
    CheckInBody, CheckOutBody, PushAttendanceBody,
    ManualMarkBody, UpdateAttendanceBody, UpdateSettingsBody,
} from "./attendance.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const attendanceController = {

    // ── Settings ──────────────────────────────────────────────────────────────

    async getSettings(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const settings = await attendanceService.getSettings(salonId);
            return sendSuccess(res, 200, settings, "Settings fetched");
        } catch (err) { return next(err); }
    },

    async updateSettings(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const settings = await attendanceService.updateSettings(salonId, req.body as UpdateSettingsBody);
            return sendSuccess(res, 200, settings, "Settings updated");
        } catch (err) { return next(err); }
    },

    // ── Check In / Out ────────────────────────────────────────────────────────

    async checkIn(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const record = await attendanceService.checkIn(salonId, req.body as CheckInBody);
            return sendSuccess(res, 200, record, "Checked in successfully");
        } catch (err) { return next(err); }
    },

    async checkOut(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const record = await attendanceService.checkOut(salonId, req.body as CheckOutBody);
            return sendSuccess(res, 200, record, "Checked out successfully");
        } catch (err) { return next(err); }
    },

    // ── Device / Biometric Push ───────────────────────────────────────────────

    async push(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const body = req.body as PushAttendanceBody;
            if (!body.staff_id) throw new AppError(400, "staff_id is required", "VALIDATION_ERROR");
            if (!["in", "out"].includes(body.check_type))
                throw new AppError(400, "check_type must be 'in' or 'out'", "VALIDATION_ERROR");
            if (!["biometric", "qr", "gps"].includes(body.source))
                throw new AppError(400, "source must be biometric, qr, or gps", "VALIDATION_ERROR");
            const record = await attendanceService.push(salonId, body);
            return sendSuccess(res, 200, record, "Attendance recorded");
        } catch (err) { return next(err); }
    },

    // ── Manual Mark ───────────────────────────────────────────────────────────

    async manualMark(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const body = req.body as ManualMarkBody;
            if (!body.staff_id || !body.date || !body.status)
                throw new AppError(400, "staff_id, date, and status are required", "VALIDATION_ERROR");
            const record = await attendanceService.manualMark(salonId, body);
            return sendSuccess(res, 200, record, "Attendance marked");
        } catch (err) { return next(err); }
    },

    // ── Edit record ───────────────────────────────────────────────────────────

    async updateRecord(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const id = String(req.params.id || "").trim();
            if (!id) throw new AppError(400, "id is required", "VALIDATION_ERROR");
            const record = await attendanceService.updateRecord(id, req.body as UpdateAttendanceBody);
            return sendSuccess(res, 200, record, "Attendance updated");
        } catch (err) { return next(err); }
    },

    // ── Today dashboard ───────────────────────────────────────────────────────

    async getToday(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const date = String(req.query.date || "").trim() || undefined;
            if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
                throw new AppError(400, "date must be YYYY-MM-DD", "VALIDATION_ERROR");
            const data = await attendanceService.getToday(salonId, date);
            return sendSuccess(res, 200, data, "Attendance fetched");
        } catch (err) { return next(err); }
    },

    // ── Monthly grid ─────────────────────────────────────────────────────────

    async getMonthly(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const year  = parseInt(String(req.query.year  || new Date().getFullYear()), 10);
            const month = parseInt(String(req.query.month || new Date().getMonth() + 1), 10);
            if (isNaN(year) || isNaN(month) || month < 1 || month > 12)
                throw new AppError(400, "Valid year and month (1-12) are required", "VALIDATION_ERROR");
            const data = await attendanceService.getMonthly(salonId, year, month);
            return sendSuccess(res, 200, data, "Monthly attendance fetched");
        } catch (err) { return next(err); }
    },

    // ── Daily summary ─────────────────────────────────────────────────────────

    async getDailySummary(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const date = String(req.query.date || "").trim() || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
            const data = await attendanceService.getDailySummary(salonId, date);
            return sendSuccess(res, 200, data, "Daily summary fetched");
        } catch (err) { return next(err); }
    },

    // ── CSV Export ────────────────────────────────────────────────────────────

    async exportCSV(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
            const year  = parseInt(String(req.query.year  || new Date().getFullYear()), 10);
            const month = parseInt(String(req.query.month || new Date().getMonth() + 1), 10);
            const { buffer, filename } = await attendanceService.exportCSV(salonId, year, month);
            res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
            res.setHeader("Content-Type", "text/csv");
            return res.send(buffer);
        } catch (err) { return next(err); }
    },
};
