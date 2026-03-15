import { MarketplaceProfile, MarketplaceLocation, MarketplaceWorkingHour, MarketplaceImage, MarketplaceFeature, UpsertEssentialsBody, UpsertAboutBody, UpsertLocationBody, UpsertWorkingHoursBody, AddImageBody, ReorderImagesBody, UpsertFeaturesBody } from "./marketplace.types";
export declare const marketplaceProfileRepo: {
    findBySalonId(salonId: string): Promise<MarketplaceProfile | null>;
    upsertEssentials(salonId: string, data: UpsertEssentialsBody): Promise<MarketplaceProfile>;
    upsertAbout(salonId: string, data: UpsertAboutBody): Promise<MarketplaceProfile>;
    setPublished(salonId: string, published: boolean): Promise<MarketplaceProfile | null>;
};
export declare const marketplaceLocationRepo: {
    findByProfileId(profileId: string): Promise<MarketplaceLocation | null>;
    upsert(profileId: string, data: UpsertLocationBody): Promise<MarketplaceLocation>;
};
export declare const marketplaceWorkingHoursRepo: {
    findByProfileId(profileId: string): Promise<MarketplaceWorkingHour[]>;
    upsertBulk(profileId: string, body: UpsertWorkingHoursBody): Promise<MarketplaceWorkingHour[]>;
};
export declare const marketplaceImagesRepo: {
    findByProfileId(profileId: string): Promise<MarketplaceImage[]>;
    findById(id: string, profileId: string): Promise<MarketplaceImage | null>;
    count(profileId: string): Promise<number>;
    add(profileId: string, data: AddImageBody): Promise<MarketplaceImage>;
    setCover(id: string, profileId: string): Promise<MarketplaceImage | null>;
    reorder(profileId: string, data: ReorderImagesBody): Promise<void>;
    delete(id: string, profileId: string): Promise<boolean>;
};
export declare const marketplaceFeaturesRepo: {
    findByProfileId(profileId: string): Promise<MarketplaceFeature[]>;
    upsert(profileId: string, data: UpsertFeaturesBody): Promise<MarketplaceFeature[]>;
};
//# sourceMappingURL=marketplace.repository.d.ts.map