export type AppointmentStatus =
    | "booked"
    | "confirmed"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "no_show";

// ─── JSONB item types ────────────────────────────────────────────────────────

export type AppointmentServiceItem = {
    service_id: string;
    staff_id?: string | null;
    name: string;
    price: number;
    quantity: number;
    time?: string | null; // "HH:MM" slot time
};

export type AppointmentPackageItem = {
    package_id: string;
    name: string;
    price: number;
    quantity: number;
};

export type AppointmentProductItem = {
    product_id?: string | null;
    name: string;
    price: number;
    quantity: number;
};

export type AppointmentMembershipItem = {
    membership_id?: string | null;
    name: string;
    duration?: string | null; // e.g. "1 Month"
    price: number;
    quantity: number;
};

export type PaymentStatusField = 'unpaid' | 'paid' | 'partial' | 'refunded';

// ─── Core Appointment type ───────────────────────────────────────────────────

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
    payment_status: PaymentStatusField;
    scheduled_at: string;
    duration_minutes: number;
    ends_at: string | null;
    colour: string | null;
    sale_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    cancelled_at: string | null;
    cancel_reason: string | null;
    // JSONB columns
    services: AppointmentServiceItem[];
    package_items: AppointmentPackageItem[];
    product_items: AppointmentProductItem[];
    membership_items: AppointmentMembershipItem[];
};

// ─── Request body types ──────────────────────────────────────────────────────

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
    // JSONB items
    services?: AppointmentServiceItem[];
    package_items?: AppointmentPackageItem[];
    product_items?: AppointmentProductItem[];
    membership_items?: AppointmentMembershipItem[];
};

export type UpdateAppointmentBody = Partial<Omit<CreateAppointmentBody, "salon_id">>;

export type CancelAppointmentBody = {
    reason?: string;
};