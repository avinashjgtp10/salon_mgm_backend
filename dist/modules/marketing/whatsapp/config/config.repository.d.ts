export declare const configRepo: {
    findBySalonId(salonId: string): Promise<any>;
    upsert(salonId: string, data: {
        phone_number_id: string;
        waba_id: string;
        access_token: string;
        webhook_verify_token: string;
        display_phone?: string;
    }): Promise<any>;
    setVerified(salonId: string, displayPhone: string, qualityRating: string, tier: number): Promise<any>;
};
//# sourceMappingURL=config.repository.d.ts.map