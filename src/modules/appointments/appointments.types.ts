export type AppointmentStatus =
    | "booked"
    | "paid"
    | "partial"
    | "cancelled"
    | "no-show"
    | "deleted";

// ─── JSONB item types ────────────────────────────────────────────────────────

export type AppointmentServiceItem = {
    service_id: string;
    staff_id?: string | null;
    staff_name?: string | null;
    name: string;
    price: number;
    quantity: number;
    time?: string | null; // "HH:MM" slot time
    is_package_service?: boolean;
    // service_categories id, copied from the booking row at save time — lets
    // a category-restricted membership benefit filter which rows it covers.
    category_id?: string | null;
    // Read-time-only enrichment (never persisted on this JSONB column) — this
    // row's own real GST, read back from the linked sale's sale_items once
    // one exists. See appointmentsService's enrichItemsWithTax.
    tax_amount?: number;
};

export type AppointmentPackageItem = {
    package_id: string;
    name: string;
    price: number;
    quantity: number;
    is_package_service?: boolean;
    staff_id?: string | null;
    staff_name?: string | null;
    start_time?: string | null;
    tax_amount?: number;
};

export type AppointmentProductItem = {
    product_id?: string | null;
    name: string;
    price: number;
    quantity: number;
    staff_id?: string | null;
    staff_name?: string | null;
    start_time?: string | null;
    // service_categories id, copied from the booking row at save time — lets
    // a category-restricted membership benefit filter which rows it covers.
    category_id?: string | null;
    tax_amount?: number;
};

export type AppointmentMembershipItem = {
    membership_id?: string | null;
    name: string;
    duration?: string | null;
    price: number;
    quantity: number;
    staff_id?: string | null;
    staff_name?: string | null;
    start_time?: string | null;
    tax_amount?: number;
};

export type AppointmentActualConsumable = {
    service_id: string;
    product_id: string;
    actual_quantity: number;
    unit: string;
    is_manual?: boolean;
    configured_quantity?: number | null;
    notes?: string | null;
};

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
    staff_alert: string | null;
    status: AppointmentStatus;
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
    // The linked sale's own invoice_number (e.g. "INV-00002") — computed at
    // query time via a subquery to sales, not a stored appointments column.
    // NULL until the appointment is actually billed (see appointments.repository.ts).
    invoice_number?: string | null;
    reward_points_value?: number | null;
    tax_breakdown?: { name: string; rate: number; amount: number; inclusive: boolean }[] | null;
    // Backfilled at read time only for an appointment with no payment yet
    // (see appointments.service.ts::backfillTaxBreakdown) — the full
    // discount+tax-inclusive total, since the raw item-price sum alone never
    // accounted for either.
    computed_grand_total?: number | null;
    // Timestamp of the most recent payment that carries a real tax_breakdown
    // (not stored as a column) — used to detect "this appointment was edited
    // AFTER its last payment," in which case that payment's tax_breakdown
    // snapshot is stale and must be recomputed rather than trusted.
    last_payment_at?: string | null;
    // Joined fields (from clients / staff tables — not stored as columns)
    client_name?: string | null;
    client_phone?: string | null;
    client_email?: string | null;
    staff_name?: string | null;
    staff_phone?: string | null;
    staff_email?: string | null;
    // JSONB columns
    services: AppointmentServiceItem[];
    package_items: AppointmentPackageItem[];
    product_items: AppointmentProductItem[];
    membership_items: AppointmentMembershipItem[];
    actual_consumables: AppointmentActualConsumable[];
    // Charges & discount (estimate, captured pre-payment)
    discount_value: number;
    discount_type: 'percentage' | 'flat';
    ex_charges: number;
    tip_amount: number;
    gst_percent: number;
    // Persisted "Include GST" checkbox state — independent of whether a
    // payment has actually been made, so a bill deliberately billed without
    // GST stays GST-free on reopen instead of being recomputed with the
    // salon's active taxes added back in. Defaults true so every
    // pre-existing row (and any appointment created before this flag
    // existed) keeps today's GST-included behavior.
    include_gst: boolean;
    // Persisted "Apply Membership" checkbox state — independent of whether a
    // payment has actually been made (payments.membership_wallet_used only
    // exists once checkout happens), so the checkbox survives Save/reopen.
    apply_membership_wallet: boolean;
    deleted_at?: string | null;
    // True once a Paid appointment has been content-edited back down to
    // 'partial' via appointments.service.ts::update() — keeps its items
    // editable on reopen, unlike a genuinely-original partial/deposit
    // booking (which stays locked). Reset is not needed: once a "Continue
    // Payment" collection brings it back to 'paid', reopening the (now
    // fully paid) booking edits through this same path again if needed.
    reopened_from_paid: boolean;
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
    /** Computed end timestamp — auto-calculated from scheduled_at + duration_minutes */
    ends_at?: string | null;
    title?: string;
    notes?: string;
    staff_alert?: string;
    status?: AppointmentStatus;
    colour?: string;
    // JSONB items
    services?: AppointmentServiceItem[];
    package_items?: AppointmentPackageItem[];
    product_items?: AppointmentProductItem[];
    membership_items?: AppointmentMembershipItem[];
    actual_consumables?: AppointmentActualConsumable[];
    // Charges & discount (estimate, captured pre-payment)
    discount_value?: number;
    discount_type?: 'percentage' | 'flat';
    ex_charges?: number;
    tip_amount?: number;
    gst_percent?: number;
    include_gst?: boolean;
    apply_membership_wallet?: boolean;
    reopened_from_paid?: boolean;
};

export type UpdateAppointmentBody = Partial<Omit<CreateAppointmentBody, "salon_id">>;

export type CancelAppointmentBody = {
    reason?: string;
};
