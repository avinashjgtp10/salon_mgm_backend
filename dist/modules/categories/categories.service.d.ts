import { CreateCategoryBody, ServiceCategory, UpdateCategoryBody } from "./categories.types";
export declare const categoriesService: {
    getMySalonId(ownerId: string): Promise<string>;
    create(params: {
        requesterUserId: string;
        body: CreateCategoryBody;
    }): Promise<ServiceCategory>;
    listMySalonCategories(params: {
        requesterUserId: string;
    }): Promise<ServiceCategory[]>;
    getByIdForMySalon(params: {
        requesterUserId: string;
        id: string;
    }): Promise<ServiceCategory>;
    updateForMySalon(params: {
        requesterUserId: string;
        id: string;
        patch: UpdateCategoryBody;
    }): Promise<ServiceCategory>;
    removeForMySalon(params: {
        requesterUserId: string;
        id: string;
    }): Promise<{
        id: string;
        deleted: true;
    }>;
};
//# sourceMappingURL=categories.service.d.ts.map