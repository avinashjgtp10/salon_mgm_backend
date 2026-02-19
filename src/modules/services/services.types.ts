export type ServiceCategory = {
  id: string;
  salon_id: string;
  name: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
};

export type Service = {
  id: string;
  salon_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: string; // pg DECIMAL comes as string
  discounted_price: string | null;
  gender_preference: string | null; // male|female|unisex
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type StaffService = {
  id: string;
  staff_id: string;
  service_id: string;
  created_at: string;
};

export type CreateCategoryBody = {
  name: string;
  description?: string;
  display_order?: number;
  is_active?: boolean;
};

export type UpdateCategoryBody = Partial<CreateCategoryBody>;

export type CreateServiceBody = {
  category_id?: string | null;
  name: string;
  description?: string;
  duration_minutes: number;
  price: number;
  discounted_price?: number | null;
  gender_preference?: "male" | "female" | "unisex";
  image_url?: string;
  is_active?: boolean;
};

export type UpdateServiceBody = Partial<CreateServiceBody>;
