export declare const webhooksService: {
    verify(salonId: string, mode: string, token: string, challenge: string): Promise<string>;
    handleWebhook(body: any): Promise<void>;
    processStatus(status: any): Promise<void>;
    refreshCounts(campaignId: string): Promise<void>;
    getRecentEvents(salonId: string, campaignId?: string): Promise<any[]>;
};
//# sourceMappingURL=webhooks.service.d.ts.map