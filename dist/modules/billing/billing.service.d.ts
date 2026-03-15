import { BillingPlan, BillingSubscription, BillingInvoice, SubscribeBillingBody, UpdateBillingSubscriptionBody, CancelBillingSubscriptionBody, ListBillingInvoicesFilters } from "./billing.types";
export declare const billingService: {
    listPlans(): Promise<BillingPlan[]>;
    getPlanById(id: string): Promise<BillingPlan>;
    getSubscription(salonId: string): Promise<BillingSubscription | null>;
    subscribe(params: {
        requesterUserId: string;
        body: SubscribeBillingBody;
    }): Promise<BillingSubscription>;
    updateSubscription(params: {
        subscriptionId: string;
        requesterUserId: string;
        patch: UpdateBillingSubscriptionBody;
    }): Promise<BillingSubscription>;
    cancelSubscription(params: {
        subscriptionId: string;
        requesterUserId: string;
        body: CancelBillingSubscriptionBody;
    }): Promise<BillingSubscription>;
    listInvoices(filters: ListBillingInvoicesFilters): Promise<{
        data: BillingInvoice[];
        total: number;
        page: number;
        limit: number;
    }>;
    getInvoice(id: string): Promise<BillingInvoice>;
};
//# sourceMappingURL=billing.service.d.ts.map