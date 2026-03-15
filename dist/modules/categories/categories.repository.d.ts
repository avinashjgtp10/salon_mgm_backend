import { CreateCategoryBody, ServiceCategory, UpdateCategoryBody } from "./categories.types";
export declare const categoriesRepository: {
    findByIdInSalon(id: string, salonId: string): Promise<ServiceCategory | null>;
    listBySalonId(salonId: string): Promise<ServiceCategory[]>;
    create(salonId: string, data: CreateCategoryBody): Promise<ServiceCategory>;
    update(id: string, salonId: string, patch: UpdateCategoryBody): Promise<ServiceCategory | null>;
    remove(id: string, salonId: string): Promise<{
        id: string;
    } | null>;
};
//# sourceMappingURL=categories.repository.d.ts.map