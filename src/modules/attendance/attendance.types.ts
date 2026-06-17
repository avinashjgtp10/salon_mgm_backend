export type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'late' | 'on_leave';
export type AttendanceSource = 'manual' | 'biometric' | 'qr' | 'gps' | 'appointment';

export type Attendance = {
    id: string;
    salon_id: string;
    staff_id: string;
    date: string;            // YYYY-MM-DD
    status: AttendanceStatus;
    check_in: string | null;   // ISO timestamp
    check_out: string | null;  // ISO timestamp
    hours_worked: number | null;
    source: AttendanceSource;
    note: string | null;
    created_at: string;
    updated_at: string;
    // joined
    staff_name?: string | null;
    staff_role?: string | null;
};

export type AttendanceSettings = {
    id: string;
    salon_id: string;
    shift_start: string;              // "HH:MM"
    shift_end: string;                // "HH:MM"
    grace_minutes: number;
    min_full_day_hours: number;
    min_half_day_hours: number;
    attendance_bonus: number;
    commission_threshold_days: number;
    created_at: string;
    updated_at: string;
};

export type CheckInBody = {
    staff_id: string;
    check_in?: string;   // ISO timestamp; defaults to NOW()
    note?: string;
};

export type CheckOutBody = {
    staff_id: string;
    check_out?: string;  // ISO timestamp; defaults to NOW()
    note?: string;
};

export type PushAttendanceBody = {
    staff_id: string;
    check_type: 'in' | 'out';
    timestamp?: string;
    source: 'biometric' | 'qr' | 'gps';
};

export type ManualMarkBody = {
    staff_id: string;
    date: string;          // YYYY-MM-DD
    status: AttendanceStatus;
    check_in?: string;
    check_out?: string;
    note?: string;
};

export type UpdateAttendanceBody = {
    status?: AttendanceStatus;
    check_in?: string;
    check_out?: string;
    note?: string;
};

export type UpdateSettingsBody = {
    shift_start?: string;
    shift_end?: string;
    grace_minutes?: number;
    min_full_day_hours?: number;
    min_half_day_hours?: number;
    attendance_bonus?: number;
    commission_threshold_days?: number;
};

export type DailySummary = {
    date: string;
    present: number;
    absent: number;
    late: number;
    on_leave: number;
    half_day: number;
    total_staff: number;
};

export type TodayStaffRecord = {
    staff_id: string;
    staff_name: string;
    staff_role: string;
    status: AttendanceStatus | 'not_marked';
    check_in: string | null;
    check_out: string | null;
    hours_worked: number | null;
    attendance_id: string | null;
};
