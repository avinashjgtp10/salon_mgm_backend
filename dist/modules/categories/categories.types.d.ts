export type ServiceCategory = {
    id: string;
    salon_id: string;
    name: string;
    description: string | null;
    display_order: number;
    is_active: boolean;
    created_at: string;
};
export type CreateCategoryBody = {
    name: string;
    description?: string;
    display_order?: number;
    is_active?: boolean;
};
export type UpdateCategoryBody = Partial<CreateCategoryBody>;
//# sourceMappingURL=categories.types.d.ts.map