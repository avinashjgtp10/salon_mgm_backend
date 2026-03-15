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
    opening_time?: string;
    closing_time?: string;
    is_active?: boolean;
};
export type UpdateBranchBody = Partial<CreateBranchBody> & {
    is_active?: boolean;
};
export type BranchTiming = {
    id: string;
    branch_id: string;
    day_of_week: number;
    opening_time: string;
    closing_time: string;
    is_closed: boolean;
    created_at: string;
};
export type TimingDayInput = {
    day_of_week: number;
    opening_time?: string;
    closing_time?: string;
    is_closed?: boolean;
};
export type SetWeeklyScheduleBody = {
    days: TimingDayInput[];
};
export type ReplaceWeeklyScheduleBody = {
    days: TimingDayInput[];
};
export type BranchHoliday = {
    id: string;
    branch_id: string;
    holiday_date: string;
    reason: string | null;
    created_at: string;
};
export type CreateHolidayBody = {
    holiday_date: string;
    reason?: string;
};
//# sourceMappingURL=branches.types.d.ts.map