import { WhatsAppConfig, SaveConfigBody } from './config.types';
export declare const configRepository: {
    findBySalonId(salonId: string): Promise<WhatsAppConfig | null>;
    upsert(salonId: string, body: SaveConfigBody): Promise<WhatsAppConfig>;
    setVerified(salonId: string, displayPhone: string, qualityRating: string, tier: number): Promise<WhatsAppConfig>;
};
//# sourceMappingURL=config.repository.d.ts.map