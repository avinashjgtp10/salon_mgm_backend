import { Product, CreateProductBody, UpdateProductBody, ProductListFilters, ProductPhoto, Brand, CreateBrandBody, UpdateBrandBody } from "./products.types";
export declare const productsRepository: {
    findById(id: string): Promise<Product | null>;
    list(filters: ProductListFilters): Promise<{
        data: Product[];
        total: number;
    }>;
    create(data: CreateProductBody): Promise<Product>;
    update(id: string, patch: UpdateProductBody): Promise<Product>;
    delete(id: string): Promise<boolean>;
};
export declare const productPhotosRepository: {
    findByProductId(productId: string): Promise<ProductPhoto[]>;
    findById(id: string): Promise<ProductPhoto | null>;
    insertMany(productId: string, files: {
        url: string;
        filename: string;
    }[], startOrder: number): Promise<ProductPhoto[]>;
    reorder(updates: {
        id: string;
        sort_order: number;
    }[]): Promise<void>;
    delete(id: string): Promise<boolean>;
    getMaxSortOrder(productId: string): Promise<number>;
};
export declare const brandsRepository: {
    findById(id: string): Promise<Brand | null>;
    findByName(name: string): Promise<Brand | null>;
    list(): Promise<Brand[]>;
    create(data: CreateBrandBody): Promise<Brand>;
    update(id: string, patch: UpdateBrandBody): Promise<Brand>;
    delete(id: string): Promise<boolean>;
};
//# sourceMappingURL=products.repository.d.ts.map