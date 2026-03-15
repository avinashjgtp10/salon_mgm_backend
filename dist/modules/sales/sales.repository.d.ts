import { Sale, SaleItem, CreateSaleBody, UpdateSaleBody } from "./sales.types";
export declare const salesRepository: {
    findById(id: string): Promise<Sale | null>;
    findItemsBySaleId(saleId: string): Promise<SaleItem[]>;
    list(filters: {
        salon_id?: string;
        client_id?: string;
        status?: string;
    }): Promise<Sale[]>;
    getDailySummary(salonId: string, date: string): Promise<{
        total: string;
        count: string;
    }>;
    create(data: CreateSaleBody, createdBy: string | null): Promise<Sale>;
    update(id: string, patch: UpdateSaleBody): Promise<Sale>;
    checkout(id: string, params: {
        payment_method: string;
        payment_reference?: string;
        status?: "completed";
    }): Promise<Sale>;
};
//# sourceMappingURL=sales.repository.d.ts.map