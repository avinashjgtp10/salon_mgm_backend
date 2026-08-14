// src/modules/categories/categories.types.ts

// Which side(s) of the catalog a category applies to. 'both' is also the
// backfill default for categories with no usage evidence either way — see
// the service_categories type migration in config/database.ts.
export type CategoryType = "service" | "product" | "both";

export type ServiceCategory = {
  id: string;
  salon_id: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  type: CategoryType;
  created_at: string;
};

export type CreateCategoryBody = {
  name: string;
  description?: string;
  display_order?: number;
  is_active?: boolean;
  type?: CategoryType;
};

export type UpdateCategoryBody = Partial<CreateCategoryBody>;