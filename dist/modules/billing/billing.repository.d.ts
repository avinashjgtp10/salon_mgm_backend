import { BillingPlan, BillingSubscription, BillingInvoice, SubscribeBillingBody, UpdateBillingSubscriptionBody, ListBillingInvoicesFilters } from "./billing.types";
export declare const billingPlansRepository: {
    findAll(): Promise<BillingPlan[]>;
    findById(id: string): Promise<BillingPlan | null>;
};
export declare const billingSubscriptionsRepository: {
    findById(id: string): Promise<BillingSubscription | null>;
    findActiveBySalonId(salonId: string): Promise<BillingSubscription | null>;
    findBySalonId(salonId: string): Promise<BillingSubscription | null>;
    create(data: SubscribeBillingBody, plan: BillingPlan, createdBy: string): Promise<BillingSubscription>;
    update(id: string, patch: UpdateBillingSubscriptionBody, plan?: BillingPlan): Promise<BillingSubscription>;
    cancel(id: string, reason?: string): Promise<BillingSubscription>;
};
export declare const billingInvoicesRepository: {
    findById(id: string): Promise<BillingInvoice | null>;
    list(filters: ListBillingInvoicesFilters): Promise<{
        data: BillingInvoice[];
        total: number;
    }>;
};
//# sourceMappingURL=billing.repository.d.ts.map