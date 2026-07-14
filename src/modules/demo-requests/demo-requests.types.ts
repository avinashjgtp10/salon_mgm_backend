export type DemoRequestStatus = "new" | "contacted" | "converted" | "closed";

export type DemoRequest = {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    salon_name: string | null;
    city: string | null;
    locations_count: string | null;
    status: DemoRequestStatus;
    created_at: string;
    updated_at: string;
};

export type CreateDemoRequestBody = {
    name?: string;
    email?: string;
    phone?: string;
    salonName?: string;
    city?: string;
    locationsCount?: string;
};
