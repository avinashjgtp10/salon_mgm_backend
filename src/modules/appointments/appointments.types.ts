export type AppointmentStatus =
    | "booked"
    | "confirmed"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "no_show";

export type Appointment = {
    id: string;
    salon_id: string;
    client_id: string | null;
    staff_id: string | null;
    service_id: string | null;
    scheduled_at: string;
    duration_minutes: number;
    status: AppointmentStatus;
    notes: string | null;
    sale_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

export type CreateAppointmentBody = {
    salon_id: string;
    client_id?: string;
    staff_id?: string;
    service_id?: string;
    scheduled_at: string;
    duration_minutes: number;
    status?: AppointmentStatus;
    notes?: string;
};

export type UpdateAppointmentBody = Partial<Omit<CreateAppointmentBody, "salon_id">>;

export type CancelAppointmentBody = {
    reason?: string;
};
