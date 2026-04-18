import { SaveConfigBody, TestConnectionResult } from './config.types';
export declare const configService: {
    getConfig(salonId: string): Promise<{
        access_token: string;
        id: string;
        salon_id: string;
        phone_number_id: string;
        waba_id: string;
        webhook_verify_token: string;
        display_phone: string | null;
        quality_rating: string;
        messaging_tier: number;
        daily_limit: number;
        is_verified: boolean;
        created_at: string;
        updated_at: string;
    } | null>;
    saveConfig(salonId: string, body: SaveConfigBody): Promise<import("./config.types").WhatsAppConfig>;
    testConnection(salonId: string): Promise<TestConnectionResult>;
};
//# sourceMappingURL=config.service.d.ts.map