export declare const configService: {
    getConfig(salonId: string): Promise<any>;
    saveConfig(salonId: string, data: {
        phoneNumberId: string;
        wabaId: string;
        accessToken: string;
        webhookVerifyToken: string;
        displayPhone?: string;
    }): Promise<any>;
    testConnection(salonId: string): Promise<{
        connected: boolean;
        displayPhone: any;
        quality: any;
        tier: any;
    }>;
};
//# sourceMappingURL=config.service.d.ts.map