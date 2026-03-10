// ─── Enums ────────────────────────────────────────────────────────────────────

export type AppointmentStatus =
    | "booked"
    | "confirmed"
    | "in_progress"
    | "completed"
    | "cancelled"
    | "no_show";

// ─── Core Type ────────────────────────────────────────────────────────────────

export type Appointment = {
    id: string;
    salon_id: string;
    branch_id: string | null;
    client_id: string | null;
    staff_id: string | null;
    service_id: string | null;
    sale_id: string | null;
    title: string;
    notes: string | null;
    status: AppointmentStatus;
    scheduled_at: string;
    duration_minutes: number;
    ends_at: string;
    colour: string | null;
    cancelled_at: string | null;
    cancel_reason: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

// ─── Sale Item ────────────────────────────────────────────────────────────────

export type CheckoutItem = {
    item_type: "service" | "product" | "membership" | "gift_card";
    item_id?: string;
    name: string;
    quantity: number;
    unit_price: number;
    discount_amount?: number;
    staff_id?: string;
};

// ─── Request Bodies ───────────────────────────────────────────────────────────

export type CreateAppointmentBody = {
    salon_id: string;
    branch_id?: string;
    client_id?: string;
    staff_id?: string;
    service_id?: string;
    title?: string;
    notes?: string;
    scheduled_at: string;
    duration_minutes: number;
    colour?: string;
};

export type UpdateAppointmentBody = {
    branch_id?: string;
    client_id?: string;
    staff_id?: string;
    service_id?: string;
    title?: string;
    notes?: string;
    scheduled_at?: string;
    duration_minutes?: number;
    colour?: string;
};

export type CancelAppointmentBody = {
    reason?: string;
};

export type CheckoutAppointmentBody = {
    items: CheckoutItem[];
    payment_method?: "Cash" | "Card" | "UPI";
    discount_amount?: number;
    tip_amount?: number;
    tax_amount?: number;
    notes?: string;
};

// ─── List Filters ─────────────────────────────────────────────────────────────

export type ListAppointmentsFilters = {
    salon_id?: string;
    branch_id?: string;
    client_id?: string;
    staff_id?: string;
    status?: AppointmentStatus;
    date?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
};
