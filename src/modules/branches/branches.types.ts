// src/modules/branches/branches.types.ts

// ================= BRANCHES =================
export type Branch = {
    id: string;
    salon_id: string;

    name: string;

    address_line1: string;
    address_line2: string | null;
    city: string;
    state: string;
    pincode: string;
    country: string;

    latitude: string | null;
    longitude: string | null;

    phone: string | null;
    email: string | null;

    is_main: boolean;

    opening_time: string | null;
    closing_time: string | null;

    is_active: boolean;

    created_at: string;
    updated_at: string;
};

export type CreateBranchBody = {
    name: string;

    address_line1: string;
    address_line2?: string;

    city: string;
    state: string;
    pincode: string;
    country?: string;

    latitude?: number;
    longitude?: number;

    phone?: string;
    email?: string;

    is_main?: boolean;

    opening_time?: string; // HH:MM
    closing_time?: string; // HH:MM

    is_active?: boolean;
};

export type UpdateBranchBody = Partial<CreateBranchBody> & {
    is_active?: boolean;
};

// ================= TIMINGS =================
export type BranchTiming = {
    id: string;
    branch_id: string;
    day_of_week: number; // 0..6
    opening_time: string;
    closing_time: string;
    is_closed: boolean;
    created_at: string;
};

export type TimingDayInput = {
    day_of_week: number;      // 0..6
    opening_time?: string;    // required if is_closed=false
    closing_time?: string;    // required if is_closed=false
    is_closed?: boolean;      // default false
};

export type SetWeeklyScheduleBody = {
    days: TimingDayInput[];   // POST partial week allowed
};

export type ReplaceWeeklyScheduleBody = {
    days: TimingDayInput[];   // PUT full week required
};

// ================= HOLIDAYS =================
export type BranchHoliday = {
    id: string;
    branch_id: string;
    holiday_date: string; // YYYY-MM-DD
    reason: string | null;
    created_at: string;
};

export type CreateHolidayBody = {
    holiday_date: string; // YYYY-MM-DD
    reason?: string;
};
