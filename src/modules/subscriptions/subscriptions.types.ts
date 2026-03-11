// ─── Enums ────────────────────────────────────────────────────

export type BillingCycle = "monthly" | "yearly" | "weekly" | "daily"

export type SubscriptionStatus =
    | "created"
    | "authenticated"
    | "active"
    | "paused"
    | "cancelled"
    | "completed"
    | "expired"

export type PaymentStatus = "paid" | "failed" | "pending" | "refunded"

// ─── DB Types ─────────────────────────────────────────────────

export type SubscriptionPlan = {
    id: string
    name: string
    slug: string
    description: string | null
    price: number
    billing_cycle: BillingCycle
    features: Record<string, any> | null
    max_branches: number | null
    max_staff: number | null
    max_bookings_per_month: number | null
    ai_features_enabled: boolean
    is_active: boolean
    razorpay_plan_id: string | null
    created_at: string
}

export type Subscription = {
    id: string
    salon_id: string
    plan_id: string
    razorpay_subscription_id: string | null
    razorpay_plan_id: string | null
    status: SubscriptionStatus
    current_period_start: string | null
    current_period_end: string | null
    cancel_at_period_end: boolean
    cancelled_at: string | null
    is_trial: boolean
    trial_start: string | null
    trial_end: string | null
    created_at: string
    updated_at: string
}

export type SubscriptionPayment = {
    id: string
    subscription_id: string
    amount: number
    payment_status: PaymentStatus
    payment_method: string | null
    transaction_id: string | null
    billing_period_start: string | null
    billing_period_end: string | null
    paid_at: string | null
    created_at: string
}

// ─── Request Bodies ───────────────────────────────────────────

export type CreatePlanBody = {
    name: string
    slug: string
    description?: string
    price: number
    billing_cycle: BillingCycle
    features?: Record<string, any>
    max_branches?: number
    max_staff?: number
    max_bookings_per_month?: number
    ai_features_enabled?: boolean
}

export type CreateSubscriptionBody = {
    salon_id: string
    plan_id: string
    total_count?: number
}

export type StartTrialBody = {
    salon_id: string
    plan_id: string
}

export type CancelSubscriptionBody = {
    cancel_at_cycle_end?: boolean
}
