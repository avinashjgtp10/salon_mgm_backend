import { Product, CreateProductBody, UpdateProductBody, ProductListFilters, ProductPhoto, ReorderPhotosBody, Brand, CreateBrandBody, UpdateBrandBody } from "./products.types";
export declare const productsService: {
    list(params: {
        requesterUserId: string;
        requesterRole?: string;
        filters: ProductListFilters;
    }): Promise<{
        data: Product[];
        total: number;
    }>;
    getById(id: string): Promise<Product & {
        photos: ProductPhoto[];
    }>;
    create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateProductBody;
        files: {
            url: string;
            filename: string;
        }[];
    }): Promise<Product & {
        photos: ProductPhoto[];
    }>;
    update(params: {
        productId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateProductBody;
    }): Promise<Product>;
    delete(params: {
        productId: string;
        requesterUserId: string;
        requesterRole?: string;
    }): Promise<void>;
    uploadPhotos(params: {
        productId: string;
        requesterUserId: string;
        files: {
            url: string;
            filename: string;
        }[];
    }): Promise<ProductPhoto[]>;
    reorderPhotos(params: {
        productId: string;
        requesterUserId: string;
        body: ReorderPhotosBody;
    }): Promise<void>;
    deletePhoto(params: {
        productId: string;
        photoId: string;
        requesterUserId: string;
    }): Promise<void>;
};
export declare const brandsService: {
    list(): Promise<Brand[]>;
    getById(id: string): Promise<Brand>;
    create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateBrandBody;
    }): Promise<Brand>;
    update(params: {
        brandId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateBrandBody;
    }): Promise<Brand>;
    delete(params: {
        brandId: string;
        requesterUserId: string;
        requesterRole?: string;
    }): Promise<void>;
};
//# sourceMappingURL=products.service.d.ts.map