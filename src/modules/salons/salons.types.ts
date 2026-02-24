export type Salon = {
    id: string;
    owner_id: string;
    business_name: string;
    business_type: string | null;
    slug: string | null;
    description: string | null;
    logo_url: string | null;
    banner_url: string | null;
    email: string | null;
    phone: string | null;
    website_url: string | null;
    gst_number: string | null;
    pan_number: string | null;
    is_verified: boolean;
    is_active: boolean;
    onboarding_completed: boolean;
    created_at: string;
    updated_at: string;
};

export type CreateSalonBody = {
    business_name: string;
    business_type?: string;
    slug?: string;
    description?: string;
    logo_url?: string;
    banner_url?: string;
    email?: string;
    phone?: string;
    website_url?: string;
    gst_number?: string;
    pan_number?: string;
};

export type UpdateSalonBody = Partial<CreateSalonBody> & {
    is_active?: boolean;
    onboarding_completed?: boolean;
};
