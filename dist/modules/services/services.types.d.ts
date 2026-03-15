export type PriceType = "fixed" | "from" | "free";
export type ScheduleType = "sequence" | "parallel";
export type BundlePriceType = "service_pricing" | "fixed" | "free";
export type AvailableFor = "all" | "male" | "female" | "other";
export type Service = {
    id: string;
    name: string;
    category_id: string;
    category_name: string | null;
    treatment_type: string | null;
    description: string | null;
    price_type: PriceType;
    price: string;
    duration: number;
    online_booking: boolean;
    commission_enabled: boolean;
    resource_required: boolean;
    is_active: boolean;
    created_at: string;
    updated_at: string;
};
export type ServiceStaff = {
    staff_id: string;
    name: string;
};
export type AddOnOption = {
    id: string;
    add_on_group_id: string;
    name: string;
    description: string | null;
    additional_price: string;
    additional_duration: number;
    created_at: string;
    updated_at: string;
};
export type AddOnGroup = {
    id: string;
    service_id: string;
    name: string;
    prompt_to_client: string | null;
    min_quantity: number | null;
    max_quantity: number | null;
    allow_multiple_same: boolean;
    created_at: string;
    updated_at: string;
};
export type AddOnGroupDetail = AddOnGroup & {
    options: AddOnOption[];
};
export type ServiceDetail = Service & {
    staff: ServiceStaff[];
    add_on_groups: AddOnGroupDetail[];
};
export type ListServicesQuery = {
    category_id?: string;
    search?: string;
    status?: "active" | "inactive";
    type?: "single" | "bundle";
    staff_id?: string;
    online_booking?: "enabled" | "disabled" | "all";
    commissions?: "enabled" | "disabled" | "all";
    resource_requirements?: "required" | "not_required" | "all";
    page?: number;
    limit?: number;
};
export type CreateServiceBody = {
    name: string;
    category_id: string;
    treatment_type?: string;
    description?: string;
    price_type?: PriceType;
    price?: number;
    duration?: number;
    online_booking?: boolean;
    commission_enabled?: boolean;
    resource_required?: boolean;
    staff_ids?: string[];
};
export type UpdateServiceBody = Partial<CreateServiceBody> & {
    is_active?: boolean;
};
export type CreateAddOnGroupBody = {
    name: string;
    prompt_to_client?: string;
    min_quantity?: number;
    max_quantity?: number;
    allow_multiple_same?: boolean;
};
export type UpdateAddOnGroupBody = Partial<CreateAddOnGroupBody>;
export type CreateAddOnOptionBody = {
    name: string;
    description?: string;
    additional_price?: number;
    additional_duration?: number;
};
export type UpdateAddOnOptionBody = Partial<CreateAddOnOptionBody>;
export type Bundle = {
    id: string;
    name: string;
    category_id: string;
    category_name: string | null;
    description: string | null;
    schedule_type: ScheduleType;
    price_type: BundlePriceType;
    retail_price: string;
    online_booking: boolean;
    commission_enabled: boolean;
    resource_required: boolean;
    available_for: AvailableFor;
    is_active: boolean;
    created_at: string;
    updated_at: string;
};
export type BundleServiceItem = {
    service_id: string;
    name: string;
    price: string;
    duration: number;
    price_type: string;
    sort_order: number;
};
export type BundleDetail = Bundle & {
    services: BundleServiceItem[];
};
export type ListBundlesQuery = {
    category_id?: string;
    search?: string;
    status?: "active" | "inactive";
    team_member_id?: string;
    online_booking?: "enabled" | "disabled" | "all";
    commissions?: "enabled" | "disabled" | "all";
    resource_requirements?: "required" | "not_required" | "all";
    available_for?: AvailableFor | "all";
    page?: number;
    limit?: number;
};
export type CreateBundleBody = {
    name: string;
    category_id: string;
    description?: string;
    schedule_type?: ScheduleType;
    price_type?: BundlePriceType;
    retail_price?: number;
    online_booking?: boolean;
    commission_enabled?: boolean;
    resource_required?: boolean;
    available_for?: AvailableFor;
    service_ids?: string[];
};
export type UpdateBundleBody = Partial<CreateBundleBody> & {
    is_active?: boolean;
};
export type Pagination = {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
};
export type ServiceListResponse = {
    data: Service[];
    pagination: Pagination;
};
export type BundleListResponse = {
    data: Bundle[];
    pagination: Pagination;
};
//# sourceMappingURL=services.types.d.ts.map