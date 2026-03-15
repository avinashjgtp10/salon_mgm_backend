import { Amenity, Highlight, Value, MarketplaceProfile, MarketplaceProfileFull, WorkingHoursDay, UpsertEssentialsBody, UpsertAboutBody, UpsertLocationBody, UpsertWorkingHoursBody, AddImageBody, ReorderImagesBody, UpsertFeaturesBody } from "./marketplace.types";
export declare const marketplaceService: {
    getProfile(salonId: string): Promise<MarketplaceProfileFull>;
    upsertEssentials(salonId: string, data: UpsertEssentialsBody): Promise<MarketplaceProfile>;
    upsertAbout(salonId: string, data: UpsertAboutBody): Promise<MarketplaceProfile>;
    getLocation(salonId: string): Promise<import("./marketplace.types").MarketplaceLocation | null>;
    upsertLocation(salonId: string, data: UpsertLocationBody): Promise<import("./marketplace.types").MarketplaceLocation>;
    getWorkingHours(salonId: string): Promise<WorkingHoursDay[]>;
    upsertWorkingHours(salonId: string, data: UpsertWorkingHoursBody): Promise<WorkingHoursDay[]>;
    getImages(salonId: string): Promise<import("./marketplace.types").MarketplaceImage[]>;
    addImage(salonId: string, data: AddImageBody): Promise<import("./marketplace.types").MarketplaceImage>;
    setCoverImage(salonId: string, imageId: string): Promise<import("./marketplace.types").MarketplaceImage>;
    reorderImages(salonId: string, data: ReorderImagesBody): Promise<import("./marketplace.types").MarketplaceImage[]>;
    deleteImage(salonId: string, imageId: string): Promise<void>;
    getFeatures(salonId: string): Promise<{
        amenities: Amenity[];
        highlights: Highlight[];
        values: Value[];
    }>;
    upsertFeatures(salonId: string, data: UpsertFeaturesBody): Promise<{
        amenities: Amenity[];
        highlights: Highlight[];
        values: Value[];
    }>;
    publish(salonId: string): Promise<MarketplaceProfile>;
    unpublish(salonId: string): Promise<MarketplaceProfile>;
};
//# sourceMappingURL=marketplace.service.d.ts.map