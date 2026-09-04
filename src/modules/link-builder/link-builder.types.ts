export type LinkType = "any" | "service" | "staff";

export type GenerateLinkBody = {
    type: LinkType;
    serviceId?: string;
    staffId?: string;
};

export type GenerateLinkResult = {
    bookingUrl: string;
    slug: string;
};

export type SavedLink = {
    id: string;
    salon_id: string;
    label: string;
    booking_url: string;
    link_type: LinkType;
    service_id: string | null;
    staff_id: string | null;
    created_at: string;
    updated_at: string;
};

export type SaveLinkBody = {
    label: string;
    bookingUrl: string;
    type: LinkType;
    serviceId?: string;
    staffId?: string;
};
