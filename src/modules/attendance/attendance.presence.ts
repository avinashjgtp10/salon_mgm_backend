import { attendanceRepository } from "./attendance.repository";
import type { Attendance, StaffPresenceState } from "./attendance.types";

// Where a staff member stands for the day, for the "show only checked-in
// staff" setting.
//
// A row with source 'appointment' was written by autoMarkFromAppointment when
// a bill was completed, which stamps check_out with the appointment's END time
// — so a stylist who punched in and just finished a service would otherwise
// read as "checked out" mid-shift. Only a real punch-out counts as one.
export function presenceState(row: Pick<Attendance, "check_in" | "check_out" | "source"> | undefined): StaffPresenceState {
    if (!row?.check_in) return "not_checked_in";
    if (row.check_out && row.source !== "appointment") return "checked_out";
    return "checked_in";
}

// Resolves to null when the salon hasn't turned the setting on, so callers can
// treat "no filtering" and "filtering with an empty result" as different things.
export async function loadStaffPresence(
    salonId: string,
    date: string
): Promise<Map<string, StaffPresenceState> | null> {
    if (!(await attendanceRepository.isCheckinVisibilityEnabled(salonId))) return null;
    const rows = await attendanceRepository.findBySalonAndDate(salonId, date);
    return new Map(rows.map((r) => [String(r.staff_id), presenceState(r)]));
}
