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
