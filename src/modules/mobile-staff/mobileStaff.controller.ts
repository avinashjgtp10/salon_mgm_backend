import { Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { appointmentsService } from "../appointments/appointments.service";
import { attendanceService } from "../attendance/attendance.service";
import { staffAttendanceState, staffSelfCheckIn, staffSelfCheckOut } from "../attendance/staffAttendance.service";
import { notificationsService } from "../notifications/notifications.service";
import {
  staffService, staffAddressService, staffEmergencyContactService,
  staffSchedulesService, staffLeavesService,
} from "../staff/staff.service";
import type { Staff } from "../staff/staff.types";
import type { MobileStaffContext, MobileStaffRequest } from "./mobileStaff.middleware";
import { getStaffMobileCalendarAccess } from "./mobileCalendarAccess";

// Every handler reads identity ONLY from req.staff (set by requireMobileStaff
// from the verified JWT + server-side staff row). No handler reads a staff,
// user or salon id from params, query, body or headers.
const getStaff = (req: MobileStaffRequest): MobileStaffContext => {
  if (!req.staff) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
  return req.staff;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LOCATION_LENGTH = 500;

const optionalDate = (value: unknown, name: string): string | undefined => {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  if (!DATE_PATTERN.test(text)) throw new AppError(400, `${name} must be YYYY-MM-DD`, "VALIDATION_ERROR");
  return text;
};

const optionalText = (value: unknown) => String(value ?? "").trim() || undefined;

const pageParams = (query: MobileStaffRequest["query"], defaultLimit: number) => ({
  page: Math.max(1, parseInt(String(query.page || "1"), 10) || 1),
  limit: Math.min(200, Math.max(1, parseInt(String(query.limit || defaultLimit), 10) || defaultLimit)),
});

// The staff row is SELECT * and includes password_hash, custom permissions and
// owner-only notes — expose only what the staff member's own profile needs.
const PROFILE_FIELDS = [
  "id", "user_id", "salon_id", "branch_id", "staff_code", "employee_code",
  "first_name", "last_name", "email", "phone", "phone_country_code", "additional_phone",
  "avatar_url", "gender", "address", "country", "birthday_day", "birthday_month",
  "designation", "specialization", "experience_years", "employment_type", "permission_level",
  "joined_date", "start_date_day", "start_date_month", "start_year",
  "end_date_day", "end_date_month", "end_year", "working_hours_per_day", "holidays",
  "calendar_color", "allow_calendar_bookings", "invitation_status", "is_active",
  "created_at", "updated_at",
] as const satisfies readonly (keyof Staff)[];

const toOwnProfile = (staff: Staff) =>
  Object.fromEntries(PROFILE_FIELDS.map((field) => [field, staff[field] ?? null]));

// Appointment `services` is jsonb; older rows may come back as a JSON string.
const serviceStaffIds = (services: unknown): string[] => {
  let list = services;
  if (typeof list === "string") {
    try { list = JSON.parse(list); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((service) => (service && typeof service === "object" ? (service as { staff_id?: unknown }).staff_id : null))
    .filter((id): id is string | number => id !== null && id !== undefined)
    .map(String);
};

// Location captured by the app at the punch: the address text, or the raw
// coordinates when no address could be resolved. Anything else is ignored.
const punchLocation = (body: unknown): string | null => {
  const input = (body && typeof body === "object" ? body : {}) as {
    location?: unknown; latitude?: unknown; longitude?: unknown;
  };
  const text = typeof input.location === "string" ? input.location.trim() : "";
  if (text) return text.slice(0, MAX_LOCATION_LENGTH);
  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  const validCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  return validCoordinates ? `${latitude}, ${longitude}` : null;
};

export const mobileStaffController = {
  // ── Profile ───────────────────────────────────────────────────────────────

  async me(req: MobileStaffRequest, res: Response, next: NextFunction) {
    try {
      const { id, salonId } = getStaff(req);
      const staff = await staffService.getById(id, salonId);
      return sendSuccess(res, 200, toOwnProfile(staff), "Staff profile fetched successfully");
    } catch (err) { return next(err); }
  },

  // Owner-controlled switch (see mobileCalendarAccess.ts). The app reads it to
  // decide whether the Calendar opens Quick Sale for this staff member.
  async calendarAccess(req: MobileStaffRequest, res: Response, next: NextFunction) {
    try {
      const { id, salonId } = getStaff(req);
      const calendarAccess = await getStaffMobileCalendarAccess(id, salonId);
      return sendSuccess(res, 200, { calendarAccess }, "Calendar access fetched successfully");
    } catch (err) { return next(err); }
  },

  async addresses(req: MobileStaffRequest, res: Response, next: NextFunction) {
    try {
      const { id, salonId } = getStaff(req);
      const data = await staffAddressService.list(id, salonId);
      return sendSuccess(res, 200, data, "Addresses fetched successfully");
    } catch (err) { return next(err); }
  },

  async emergencyContacts(req: MobileStaffRequest, res: Response, next: NextFunction) {
    try {
      const { id, salonId } = getStaff(req);
      const data = await staffEmergencyContactService.list(id, salonId);
      return sendSuccess(res, 200, data, "Emergency contacts fetched successfully");
    } catch (err) { return next(err); }
  },

  // ── Appointments ──────────────────────────────────────────────────────────

  // Same query params and response shape as GET /appointments, always scoped
  // to appointments assigned to the caller (main staff or any service row).
  async appointments(req: MobileStaffRequest, res: Response, next: NextFunction) {
    try {
      const { id, salonId } = getStaff(req);
      const result = await appointmentsService.list({
        salonId,
        assignedStaffId: id,
        date: optionalDate(req.query.date, "date"),
        startDate: optionalDate(req.query.start_date, "start_date"),
        endDate: optionalDate(req.query.end_date, "end_date"),
        status: optionalText(req.query.status),
        ...pageParams(req.query, 50),
      });
      return sendSuccess(res, 200, result, "Appointments fetched successfully");
    } catch (err) { return next(err); }
  },

  async appointmentById(req: MobileStaffRequest, res: Response, next: NextFunction) {
    try {
      const { id: staffId, salonId } = getStaff(req);
      const appointmentId = String(req.params.id || "").trim();
      if (!appointmentId) throw new AppError(400, "id is required", "VALIDATION_ERROR");
      const appointment = await appointmentsService.getById(appointmentId);
      const assigned = String(appointment.staff_id ?? "") === staffId ||
        serviceStaffIds((appointment as { services?: unknown }).services).includes(staffId);
      // 404 (not 403) so staff can't probe which appointment ids exist.
      if (appointment.salon_id !== salonId || !assigned) {
        throw new AppError(404, "Appointment not found", "NOT_FOUND");
      }
      return sendSuccess(res, 200, appointment, "Appointment fetched successfully");
    } catch (err) { return next(err); }
  },

  // ── Schedule (weekly rows + date overrides from staff_schedules, plus leaves) ─

  async schedule(req: MobileStaffRequest, res: Response, next: NextFunction) {
    try {
      const { id, salonId } = getStaff(req);
      const [schedules, leaves] = await Promise.all([
        staffSchedulesService.list(id, salonId),
        staffLeavesService.list(id, salonId, optionalDate(req.query.from, "from"), optionalDate(req.query.to, "to")),
      ]);
      return sendSuccess(res, 200, { schedules, leaves }, "Schedule fetched successfully");
    } catch (err) { return next(err); }
  },

  // ── Attendance ────────────────────────────────────────────────────────────

  // Today's self-attendance state (same object as /attendance/today's
  // `self_attendance`), plus the caller's own history for an optional range.
  async attendance(req: MobileStaffRequest, res: Response, next: NextFunction) {
    try {
      const { id, userId, salonId } = getStaff(req);
      const startDate = optionalDate(req.query.start_date, "start_date");
      const endDate = optionalDate(req.query.end_date, "end_date");
      const [selfAttendance, history] = await Promise.all([
        staffAttendanceState(userId, salonId),
        startDate || endDate
          ? attendanceService.getForStaff(id, { startDate, endDate, ...pageParams(req.query, 31) })
          : Promise.resolve(null),
      ]);
      return sendSuccess(res, 200, { self_attendance: selfAttendance, history }, "Attendance fetched");
    } catch (err) { return next(err); }
  },

  async checkIn(req: MobileStaffRequest, res: Response, next: NextFunction) {
    try {
      const { userId, salonId } = getStaff(req);
      const state = await staffSelfCheckIn(userId, salonId, new Date(), punchLocation(req.body));
      return sendSuccess(res, 200, { self_attendance: state }, "Checked in successfully");
    } catch (err) { return next(err); }
  },

  async checkOut(req: MobileStaffRequest, res: Response, next: NextFunction) {
    try {
      const { userId, salonId } = getStaff(req);
      const state = await staffSelfCheckOut(userId, salonId, new Date(), punchLocation(req.body));
      return sendSuccess(res, 200, { self_attendance: state }, "Checked out successfully");
    } catch (err) { return next(err); }
  },

  // ── Notifications (recipient-scoped by the JWT user; per-user read receipts) ─
  // Response bodies mirror /notifications so the app can switch URLs only.

  async notifications(req: MobileStaffRequest, res: Response, next: NextFunction) {
    try {
      const { userId, salonId } = getStaff(req);
      const data = await notificationsService.list(salonId, userId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async unreadNotificationCount(req: MobileStaffRequest, res: Response, next: NextFunction) {
    try {
      const { userId, salonId } = getStaff(req);
      const count = await notificationsService.getUnreadCount(salonId, userId);
      return res.json({ success: true, data: { count } });
    } catch (err) { return next(err); }
  },

  async markNotificationRead(req: MobileStaffRequest, res: Response, next: NextFunction) {
    try {
      const { userId, salonId } = getStaff(req);
      const data = await notificationsService.markRead(String(req.params.id ?? ""), salonId, userId);
      return res.json({ success: true, data });
    } catch (err) { return next(err); }
  },

  async markAllNotificationsRead(req: MobileStaffRequest, res: Response, next: NextFunction) {
    try {
      const { userId, salonId } = getStaff(req);
      await notificationsService.markAllRead(salonId, userId);
      return res.json({ success: true });
    } catch (err) { return next(err); }
  },
};
