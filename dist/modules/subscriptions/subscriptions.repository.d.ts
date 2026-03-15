import { SubscriptionPlan, Subscription, SubscriptionPayment, CreatePlanBody, SubscriptionStatus } from "./subscriptions.types";
export declare const subscriptionsRepository: {
    createPlan(data: CreatePlanBody & {
        razorpay_plan_id: string;
    }): Promise<SubscriptionPlan>;
    listPlans(): Promise<SubscriptionPlan[]>;
    findPlanById(id: string): Promise<SubscriptionPlan | null>;
    createSubscription(data: {
        salon_id: string;
        plan_id: string;
        razorpay_subscription_id: string;
        razorpay_plan_id: string;
        status: SubscriptionStatus;
    }): Promise<Subscription>;
    startTrial(data: {
        salon_id: string;
        plan_id: string;
    }): Promise<Subscription>;
    findSubscriptionById(id: string): Promise<Subscription | null>;
    findByRazorpayId(razorpaySubId: string): Promise<Subscription | null>;
    findBySalonId(salonId: string): Promise<Subscription[]>;
    findActiveTrial(salonId: string): Promise<Subscription | null>;
    hasUsedTrial(salonId: string): Promise<boolean>;
    updateSubscriptionStatus(razorpaySubId: string, status: SubscriptionStatus, extra?: Record<string, unknown>): Promise<Subscription>;
    createPayment(data: {
        subscription_id: string;
        amount: number;
        payment_status: string;
        payment_method?: string;
        transaction_id?: string;
        billing_period_start?: string;
        billing_period_end?: string;
        paid_at?: string;
    }): Promise<SubscriptionPayment>;
    listPaymentsBySubscription(subscriptionId: string): Promise<SubscriptionPayment[]>;
};
//# sourceMappingURL=subscriptions.repository.d.ts.map