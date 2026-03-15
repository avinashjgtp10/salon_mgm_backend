import { CreatePlanBody, CreateSubscriptionBody, StartTrialBody, CancelSubscriptionBody } from "./subscriptions.types";
export declare const subscriptionsService: {
    createPlan(body: CreatePlanBody): Promise<import("./subscriptions.types").SubscriptionPlan>;
    listPlans(): Promise<import("./subscriptions.types").SubscriptionPlan[]>;
    getPlan(id: string): Promise<import("./subscriptions.types").SubscriptionPlan>;
    startTrial(body: StartTrialBody): Promise<{
        trial_days_remaining: number;
        message: string;
        id: string;
        salon_id: string;
        plan_id: string;
        razorpay_subscription_id: string | null;
        razorpay_plan_id: string | null;
        status: import("./subscriptions.types").SubscriptionStatus;
        current_period_start: string | null;
        current_period_end: string | null;
        cancel_at_period_end: boolean;
        cancelled_at: string | null;
        is_trial: boolean;
        trial_start: string | null;
        trial_end: string | null;
        created_at: string;
        updated_at: string;
    }>;
    getTrialStatus(salonId: string): Promise<{
        has_trial: boolean;
        trial_used: boolean;
        trial_days_remaining: number;
        trial_start?: undefined;
        trial_end?: undefined;
    } | {
        has_trial: boolean;
        trial_used: boolean;
        trial_days_remaining: number;
        trial_start: string | null;
        trial_end: string | null;
    }>;
    createSubscription(body: CreateSubscriptionBody): Promise<{
        subscription: import("./subscriptions.types").Subscription;
        razorpay_subscription_id: string;
        short_url: any;
    }>;
    getSubscription(id: string): Promise<import("./subscriptions.types").Subscription>;
    getSubscriptionsBySalon(salonId: string): Promise<import("./subscriptions.types").Subscription[]>;
    cancelSubscription(id: string, body: CancelSubscriptionBody): Promise<import("./subscriptions.types").Subscription>;
    getPayments(subscriptionId: string): Promise<import("./subscriptions.types").SubscriptionPayment[]>;
    verifyWebhook(rawBody: string, signature: string): boolean;
    handleWebhookEvent(event: string, payload: any): Promise<void>;
};
//# sourceMappingURL=subscriptions.service.d.ts.map