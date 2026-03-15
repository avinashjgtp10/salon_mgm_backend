export type AppointmentStatus = "booked" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";
export type Appointment = {
    id: string;
    salon_id: string;
    branch_id: string | null;
    client_id: string | null;
    staff_id: string | null;
    service_id: string | null;
    title: string | null;
    notes: string | null;
    status: AppointmentStatus;
    scheduled_at: string;
    duration_minutes: number;
    ends_at: string | null;
    colour: string | null;
    sale_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};
export type CreateAppointmentBody = {
    salon_id: string;
    branch_id?: string;
    client_id?: string;
    staff_id?: string;
    service_id?: string;
    scheduled_at: string;
    duration_minutes: number;
    title?: string;
    notes?: string;
    status?: AppointmentStatus;
    colour?: string;
};
export type UpdateAppointmentBody = Partial<Omit<CreateAppointmentBody, "salon_id">>;
export type CancelAppointmentBody = {
    reason?: string;
};
//# sourceMappingURL=appointments.types.d.ts.map