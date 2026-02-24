export type Staff = {
    id: string;
    user_id: string;
    salon_id: string;
    branch_id: string | null;
    designation: string | null;
    specialization: string[] | null;
    experience_years: number | null;
    commission_type: string | null;
    commission_value: string | null;
    is_active: boolean;
    joined_date: string | null;
    created_at: string;
    updated_at: string;
};

export type CreateStaffBody = {
    user_id: string;
    salon_id: string;
    branch_id?: string;
    designation?: string;
    specialization?: string[];
    experience_years?: number;
    commission_type?: string;
    commission_value?: number | string;
    is_active?: boolean;
    joined_date?: string;
};

export type UpdateStaffBody = Partial<CreateStaffBody>;

export type StaffSchedule = {
    id: string;
    staff_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    is_available: boolean;
    created_at: string;
};

export type CreateStaffScheduleBody = {
    staff_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    is_available?: boolean;
};

export type UpdateStaffScheduleBody = Partial<CreateStaffScheduleBody>;

export type StaffLeave = {
    id: string;
    staff_id: string;
    start_date: string;
    end_date: string;
    reason: string | null;
    leave_type: string | null;
    status: string;
    created_at: string;
};

export type CreateStaffLeaveBody = {
    staff_id: string;
    start_date: string;
    end_date: string;
    reason?: string;
    leave_type?: string;
    status?: string;
};

export type UpdateStaffLeaveBody = Partial<CreateStaffLeaveBody>;
