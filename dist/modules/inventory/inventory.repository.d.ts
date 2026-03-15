import { Supplier, CreateSupplierBody, UpdateSupplierBody, StockMovement, CreateStockMovementBody, ListStockMovementsFilters } from "./inventory.types";
export declare const suppliersRepository: {
    findById(id: string): Promise<Supplier | null>;
    listAll(): Promise<Supplier[]>;
    create(data: CreateSupplierBody): Promise<Supplier>;
    update(id: string, patch: UpdateSupplierBody): Promise<Supplier>;
    delete(id: string): Promise<void>;
};
export declare const stockMovementsRepository: {
    findById(id: string): Promise<StockMovement | null>;
    list(filters: ListStockMovementsFilters): Promise<{
        data: StockMovement[];
        total: number;
    }>;
    create(data: CreateStockMovementBody, createdBy: string): Promise<StockMovement>;
};
export declare const stockTakeRepository: {
    process(params: {
        branch_id: string;
        notes?: string;
        items: {
            product_id: string;
            actual_qty: number;
            notes?: string;
        }[];
        created_by: string;
    }): Promise<StockMovement[]>;
};
//# sourceMappingURL=inventory.repository.d.ts.map