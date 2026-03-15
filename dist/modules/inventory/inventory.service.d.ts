import { Supplier, CreateSupplierBody, UpdateSupplierBody, StockMovement, CreateStockMovementBody, StockTakeBody, StockTakeResult, ListStockMovementsFilters } from "./inventory.types";
export declare const suppliersService: {
    create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateSupplierBody;
    }): Promise<Supplier>;
    getById(id: string): Promise<Supplier>;
    listAll(): Promise<Supplier[]>;
    update(params: {
        supplierId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateSupplierBody;
    }): Promise<Supplier>;
    delete(params: {
        supplierId: string;
        requesterUserId: string;
        requesterRole?: string;
    }): Promise<void>;
};
export declare const stockMovementsService: {
    create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateStockMovementBody;
    }): Promise<StockMovement>;
    getById(id: string): Promise<StockMovement>;
    list(filters: ListStockMovementsFilters): Promise<{
        data: StockMovement[];
        total: number;
        page: number;
        limit: number;
    }>;
};
export declare const stockTakeService: {
    process(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: StockTakeBody;
    }): Promise<StockTakeResult>;
};
//# sourceMappingURL=inventory.service.d.ts.map