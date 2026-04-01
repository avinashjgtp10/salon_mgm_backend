import { WAWebhookEvent } from './webhooks.types';
export declare const webhooksRepository: {
    findVerifyToken(salonId: string): Promise<string | null>;
    findContactByWamid(wamid: string): Promise<any>;
    markDelivered(wamid: string, timestamp: Date): Promise<void>;
    markRead(wamid: string, timestamp: Date): Promise<void>;
    markFailed(wamid: string, status: string, errorCode: string | null, errorMessage: string | null): Promise<void>;
    refreshCampaignCounts(campaignId: string): Promise<void>;
    getRecentEvents(salonId: string, campaignId?: string): Promise<WAWebhookEvent[]>;
};
//# sourceMappingURL=webhooks.repository.d.ts.map