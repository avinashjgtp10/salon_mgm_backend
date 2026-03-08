export type BillingPlanInterval = "monthly" | "yearly";
export type BillingStatus = "trialing" | "active" | "past_due" | "cancelled" | "inactive";
export type BillingPaymentMethod = "card" | "upi" | "bank_transfer" | "cash";

// ─── Core Types ───────────────────────────────────────────────────────────────

export type BillingPlan = {
    id: string;
    name: string;
    description: string | null;
    price_per_unit: string;
    billing_unit: string;
    interval: BillingPlanInterval;
    trial_days: number;
    features: Record<string, boolean> | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
};

export type BillingSubscription = {
    id: string;
    salon_id: string;
    plan_id: string;
    status: BillingStatus;
    quantity: number;
    unit_price: string;
    total_amount: string;
    current_period_start: string;
    current_period_end: string;
    trial_ends_at: string | null;
    // card
    payment_method: BillingPaymentMethod | null;
    card_holder_name: string | null;
    card_last4: string | null;
    card_brand: string | null;
    card_expiry: string | null;
    // billing details
    account_type: string | null;
    billing_first_name: string | null;
    billing_last_name: string | null;
    billing_address: string | null;
    vat_number: string | null;
    // cancel
    cancelled_at: string | null;
    cancel_reason: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
};

export type BillingInvoice = {
    id: string;
    salon_id: string;
    subscription_id: string | null;
    invoice_number: string;
    status: "draft" | "open" | "paid" | "void";
    quantity: number;
    unit_price: string;
    subtotal: string;
    tax_amount: string;
    total_amount: string;
    period_start: string | null;
    period_end: string | null;
    due_date: string | null;
    paid_at: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
};

// ─── Request Bodies ───────────────────────────────────────────────────────────

export type SubscribeBillingBody = {
    salon_id: string;
    plan_id: string;
    quantity: number;
    // card fields — from "Card holder full name", "Card number", "Expiry date", "CVV"
    payment_method?: BillingPaymentMethod;
    card_holder_name?: string;
    card_last4?: string;
    card_brand?: string;
    card_expiry?: string;              // "MM/YY"
    // billing details — from "Billing details" section
    account_type?: string;           // "Individual / Self-employed" | "Business"
    billing_first_name?: string;
    billing_last_name?: string;
    billing_address?: string;
    vat_number?: string;
};

export type UpdateBillingSubscriptionBody = {
    quantity?: number;
    payment_method?: BillingPaymentMethod;
    card_holder_name?: string;
    card_last4?: string;
    card_brand?: string;
    card_expiry?: string;
    account_type?: string;
    billing_first_name?: string;
    billing_last_name?: string;
    billing_address?: string;
    vat_number?: string;
};

export type CancelBillingSubscriptionBody = {
    reason?: string;
};

export type ListBillingInvoicesFilters = {
    salon_id?: string;
    subscription_id?: string;
    status?: string;
    page?: number;
    limit?: number;
};
