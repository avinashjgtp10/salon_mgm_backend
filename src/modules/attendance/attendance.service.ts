import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { attendanceRepository } from "./attendance.repository";
import {
    Attendance,
    AttendanceSettings,
    AttendanceStatus,
    AttendanceSource,
    CheckInBody,
    CheckOutBody,
    PushAttendanceBody,
    ManualMarkBody,
    UpdateAttendanceBody,
    UpdateSettingsBody,
    DailySummary,
    TodayStaffRecord,
} from "./attendance.types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayIST(): string {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
}

function parseTimeToMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
}

function hoursFromTimestamps(checkIn: string, checkOut: string): number {
    const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
    return Math.max(0, parseFloat((diff / 3_600_000).toFixed(2)));
}

function calcStatus(
    checkIn: string,
    checkOut: string | null,
    settings: AttendanceSettings
): AttendanceStatus {
    const checkInDate = new Date(checkIn);
    const checkInMinutes = checkInDate.getUTCHours() * 60 + checkInDate.getUTCMinutes();
    const shiftStartMinutes = parseTimeToMinutes(settings.shift_start);
    const isLate = checkInMinutes > shiftStartMinutes + settings.grace_minutes;

    if (!checkOut) {
        return isLate ? "late" : "present";
    }

    const hours = hoursFromTimestamps(checkIn, checkOut);

    if (hours < settings.min_half_day_hours) return "absent";
    if (hours < settings.min_full_day_hours) return "half_day";
    return isLate ? "late" : "present";
}

function defaultSettings(): Omit<AttendanceSettings, "id" | "salon_id" | "created_at" | "updated_at"> {
    return {
        shift_start: "09:00",
        shift_end: "18:00",
        grace_minutes: 15,
        min_full_day_hours: 7,
        min_half_day_hours: 3.5,
        attendance_bonus: 0,
        commission_threshold_days: 0,
    };
}

// ── Service ────────────────────────────────────────────────────────────────────

export const attendanceService = {

    // ── Settings ──────────────────────────────────────────────────────────────

    async getSettings(salonId: string): Promise<AttendanceSettings> {
        const existing = await attendanceRepository.getSettings(salonId);
        if (existing) return existing;
        // Return in-memory defaults without persisting
        return {
            id: "",
            salon_id: salonId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...defaultSettings(),
        };
    },

    async updateSettings(salonId: string, data: UpdateSettingsBody): Promise<AttendanceSettings> {
        if (Object.keys(data).length === 0)
            throw new AppError(400, "No fields provided to update", "VALIDATION_ERROR");
        return attendanceRepository.upsertSettings(salonId, data);
    },

    // ── Check In ──────────────────────────────────────────────────────────────

    async checkIn(salonId: string, body: CheckInBody): Promise<Attendance> {
        const { staff_id, check_in, note } = body;
        const checkInTs = check_in || new Date().toISOString();
        const date = new Date(checkInTs).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

        const onLeave = await attendanceRepository.hasApprovedLeave(staff_id, date);
        if (onLeave) throw new AppError(400, "Staff member is on approved leave today", "ON_LEAVE");

        const settings = await attendanceService.getSettings(salonId);
        const status = calcStatus(checkInTs, null, settings);

        const record = await attendanceRepository.upsertCheckIn({
            salonId, staffId: staff_id, date, checkIn: checkInTs, status, source: "manual", note,
        });
        logger.info("attendance.checkIn", { salonId, staffId: staff_id, date, status });
        return record;
    },

    // ── Check Out ─────────────────────────────────────────────────────────────

    async checkOut(salonId: string, body: CheckOutBody): Promise<Attendance> {
        const { staff_id, check_out, note } = body;
        const checkOutTs = check_out || new Date().toISOString();
        const date = new Date(checkOutTs).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

        const existing = await attendanceRepository.findByStaffAndDate(staff_id, date);
        if (!existing) throw new AppError(400, "No check-in found for this staff today", "NOT_CHECKED_IN");
        if (!existing.check_in) throw new AppError(400, "Staff has not checked in yet", "NOT_CHECKED_IN");
        if (existing.check_out) throw new AppError(400, "Staff has already checked out", "ALREADY_CHECKED_OUT");

        const settings = await attendanceService.getSettings(salonId);
        const hours = hoursFromTimestamps(existing.check_in, checkOutTs);
        const status = calcStatus(existing.check_in, checkOutTs, settings);

        const record = await attendanceRepository.upsertCheckOut({
            salonId, staffId: staff_id, date, checkOut: checkOutTs, status, hoursWorked: hours, note,
        });
        logger.info("attendance.checkOut", { salonId, staffId: staff_id, date, status, hours });
        return record;
    },

    // ── Device / Biometric Push ───────────────────────────────────────────────

    async push(salonId: string, body: PushAttendanceBody): Promise<Attendance> {
        const { staff_id, check_type, timestamp, source } = body;
        const ts = timestamp || new Date().toISOString();
        const date = new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

        if (check_type === "in") {
            const onLeave = await attendanceRepository.hasApprovedLeave(staff_id, date);
            if (onLeave) {
                return attendanceRepository.upsert({
                    salonId, staffId: staff_id, date, status: "on_leave", source, checkIn: ts,
                });
            }
            const settings = await attendanceService.getSettings(salonId);
            const status = calcStatus(ts, null, settings);
            return attendanceRepository.upsertCheckIn({ salonId, staffId: staff_id, date, checkIn: ts, status, source });
        }

        // check_type === "out"
        const existing = await attendanceRepository.findByStaffAndDate(staff_id, date);
        if (!existing || !existing.check_in) {
            // No check-in: upsert with check-out only, treat as present
            return attendanceRepository.upsert({
                salonId, staffId: staff_id, date, status: "present", source, checkOut: ts,
            });
        }

        const settings = await attendanceService.getSettings(salonId);
        const hours = hoursFromTimestamps(existing.check_in, ts);
        const status = calcStatus(existing.check_in, ts, settings);
        return attendanceRepository.upsertCheckOut({
            salonId, staffId: staff_id, date, checkOut: ts, status, hoursWorked: hours,
        });
    },

    // ── Manual Mark ───────────────────────────────────────────────────────────

    async manualMark(salonId: string, body: ManualMarkBody): Promise<Attendance> {
        const { staff_id, date, status, check_in, check_out, note } = body;
        let hoursWorked: number | undefined;
        if (check_in && check_out) {
            hoursWorked = hoursFromTimestamps(check_in, check_out);
        }
        return attendanceRepository.manualUpsert({
            salonId, staffId: staff_id, date, status, checkIn: check_in, checkOut: check_out, hoursWorked, note,
        });
    },

    // ── Edit existing record ──────────────────────────────────────────────────

    async updateRecord(id: string, patch: UpdateAttendanceBody): Promise<Attendance> {
        const existing = await attendanceRepository.findById(id);
        if (!existing) throw new AppError(404, "Attendance record not found", "NOT_FOUND");

        const checkIn  = patch.check_in  ?? existing.check_in  ?? undefined;
        const checkOut = patch.check_out ?? existing.check_out ?? undefined;

        let finalPatch: UpdateAttendanceBody = { ...patch };
        if (checkIn && checkOut) {
            finalPatch.status = (patch.status as AttendanceStatus) ?? (await (async () => {
                const settings = await attendanceService.getSettings(existing.salon_id);
                return calcStatus(checkIn, checkOut, settings);
            })());
        }
        return attendanceRepository.updateById(id, finalPatch);
    },

    // ── Today dashboard ───────────────────────────────────────────────────────

    async getToday(salonId: string): Promise<{
        summary: DailySummary;
        staff: TodayStaffRecord[];
    }> {
        const date = todayIST();
        const [allStaff, records, counts] = await Promise.all([
            attendanceRepository.getActiveSalonStaff(salonId),
            attendanceRepository.findBySalonAndDate(salonId, date),
            attendanceRepository.getDailySummaryCounts(salonId, date),
        ]);

        const recordMap = new Map(records.map(r => [r.staff_id, r]));

        const staff: TodayStaffRecord[] = allStaff.map(s => {
            const rec = recordMap.get(s.id);
            return {
                staff_id: s.id,
                staff_name: s.full_name,
                staff_role: s.role,
                status: rec ? rec.status : "not_marked",
                check_in: rec?.check_in ?? null,
                check_out: rec?.check_out ?? null,
                hours_worked: rec?.hours_worked ?? null,
                attendance_id: rec?.id ?? null,
            };
        });

        const summary: DailySummary = {
            date,
            present:     counts.present,
            absent:      counts.absent,
            late:        counts.late,
            on_leave:    counts.on_leave,
            half_day:    counts.half_day,
            total_staff: allStaff.length,
        };

        return { summary, staff };
    },

    // ── Monthly grid ─────────────────────────────────────────────────────────

    async getMonthly(salonId: string, year: number, month: number): Promise<{
        staff: { id: string; full_name: string; role: string }[];
        records: Attendance[];
    }> {
        const [allStaff, records] = await Promise.all([
            attendanceRepository.getActiveSalonStaff(salonId),
            attendanceRepository.findBySalonAndMonth(salonId, year, month),
        ]);
        return { staff: allStaff, records };
    },

    // ── Daily summary counts ─────────────────────────────────────────────────

    async getDailySummary(salonId: string, date: string): Promise<DailySummary> {
        const [counts, staff] = await Promise.all([
            attendanceRepository.getDailySummaryCounts(salonId, date),
            attendanceRepository.getActiveSalonStaff(salonId),
        ]);
        return {
            date,
            ...counts,
            total_staff: staff.length,
        };
    },

    // ── CSV Export ────────────────────────────────────────────────────────────

    async exportCSV(salonId: string, year: number, month: number): Promise<{ buffer: Buffer; filename: string }> {
        const records = await attendanceRepository.getMonthlyForExport(salonId, year, month);

        const headers = ["Date", "Staff Name", "Role", "Status", "Check In", "Check Out", "Hours Worked", "Source", "Note"];
        const rows = records.map(r => [
            r.date,
            r.staff_name ?? "",
            r.staff_role ?? "",
            r.status,
            r.check_in  ? new Date(r.check_in).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })  : "",
            r.check_out ? new Date(r.check_out).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "",
            r.hours_worked != null ? String(r.hours_worked) : "",
            r.source,
            r.note ?? "",
        ]);

        const csvLines = [headers.join(","), ...rows.map(r => r.map(v => `"${v}"`).join(","))];
        const monthStr = String(month).padStart(2, "0");

        return {
            buffer: Buffer.from(csvLines.join("\n"), "utf-8"),
            filename: `attendance_${year}_${monthStr}.csv`,
        };
    },

    // ── Auto-mark from appointment checkout ───────────────────────────────────

    async autoMarkFromAppointment(params: {
        salonId: string;
        staffId: string;
        scheduledAt: string;
        durationMinutes: number;
    }): Promise<void> {
        try {
            const { salonId, staffId, scheduledAt, durationMinutes } = params;
            const date = new Date(scheduledAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

            const onLeave = await attendanceRepository.hasApprovedLeave(staffId, date);
            if (onLeave) return;

            const checkIn  = scheduledAt;
            const checkOut = new Date(new Date(scheduledAt).getTime() + durationMinutes * 60_000).toISOString();
            const hours    = hoursFromTimestamps(checkIn, checkOut);
            const settings = await attendanceService.getSettings(salonId);
            const status   = calcStatus(checkIn, checkOut, settings);

            await attendanceRepository.upsert({
                salonId,
                staffId,
                date,
                status,
                source: "appointment",
                checkIn,
                checkOut,
                hoursWorked: hours,
            });

            logger.info("attendance.autoMarkFromAppointment", { salonId, staffId, date, status });
        } catch (err) {
            // Never block appointment checkout
            logger.error("attendance.autoMarkFromAppointment failed", { err });
        }
    },
};
