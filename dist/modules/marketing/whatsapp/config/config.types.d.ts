export type WhatsAppConfig = {
    id: string;
    salon_id: string;
    phone_number_id: string;
    waba_id: string;
    access_token: string;
    webhook_verify_token: string;
    display_phone: string | null;
    quality_rating: string;
    messaging_tier: number;
    daily_limit: number;
    is_verified: boolean;
    created_at: string;
    updated_at: string;
};
export type SaveConfigBody = {
    phone_number_id: string;
    waba_id: string;
    access_token: string;
    webhook_verify_token: string;
    display_phone?: string | null;
};
export type TestConnectionResult = {
    success: boolean;
    tier: string;
    qualityRating: string;
};
//# sourceMappingURL=config.types.d.ts.map