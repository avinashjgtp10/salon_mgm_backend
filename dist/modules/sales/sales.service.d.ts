import { Sale, SaleItem, CreateSaleBody, UpdateSaleBody, CheckoutSaleBody } from "./sales.types";
export declare const salesService: {
    create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateSaleBody;
    }): Promise<{
        sale: Sale;
        items: SaleItem[];
    }>;
    getById(id: string): Promise<{
        sale: Sale;
        items: SaleItem[];
    }>;
    list(filters: {
        salon_id?: string;
        client_id?: string;
        status?: string;
    }): Promise<Sale[]>;
    getDailySummary(salonId: string, date: string): Promise<{
        total: string;
        count: string;
    }>;
    update(params: {
        id: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateSaleBody;
    }): Promise<Sale>;
    checkout(params: {
        id: string;
        requesterUserId: string;
        requesterRole?: string;
        body: CheckoutSaleBody;
    }): Promise<Sale>;
};
//# sourceMappingURL=sales.service.d.ts.map