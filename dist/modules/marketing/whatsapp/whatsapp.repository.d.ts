import { WAConfig, SaveConfigBody, WATemplate, CreateTemplateBody, WACampaign, WACampaignContact } from './whatsapp.types';
export declare const waConfigRepository: {
    findBySalonId(salonId: string): Promise<WAConfig | null>;
    upsert(salonId: string, body: SaveConfigBody): Promise<WAConfig>;
    setVerified(salonId: string, displayPhone: string, qualityRating: string, tier: number): Promise<WAConfig>;
};
export declare const waTemplatesRepository: {
    findAll(salonId: string): Promise<WATemplate[]>;
    findById(id: string, salonId: string): Promise<WATemplate | null>;
    create(salonId: string, body: CreateTemplateBody & {
        meta_template_id?: string | null;
        status?: string;
    }): Promise<WATemplate>;
    updateStatus(id: string, status: string, metaTemplateId?: string | null, rejectionReason?: string | null): Promise<WATemplate>;
    delete(id: string, salonId: string): Promise<boolean>;
};
export declare const waCampaignsRepository: {
    findAll(salonId: string): Promise<WACampaign[]>;
    findById(id: string, salonId: string): Promise<WACampaign | null>;
    create(salonId: string, templateId: string, name: string, batchSize: number, totalContacts: number): Promise<string>;
    bulkInsertContacts(campaignId: string, contacts: Array<{
        phone: string;
        name?: string | null;
        variables?: Record<string, any>;
    }>): Promise<void>;
    getContactIds(campaignId: string): Promise<string[]>;
    getPendingContactIds(campaignId: string): Promise<string[]>;
    updateStatus(id: string, status: string): Promise<WACampaign>;
    getContacts(campaignId: string, status?: string): Promise<WACampaignContact[]>;
    getReport(campaignId: string, type: string): Promise<WACampaignContact[]>;
};
export declare const waDashboardRepository: {
    getStats(salonId: string): Promise<any>;
    getDailyVolume(salonId: string): Promise<any[]>;
};
export declare const waWebhooksRepository: {
    findContactByWamid(wamid: string): Promise<any>;
    markDelivered(wamid: string, timestamp: Date): Promise<void>;
    markRead(wamid: string, timestamp: Date): Promise<void>;
    markFailed(wamid: string, status: string, errorCode: string | null, errorMessage: string | null): Promise<void>;
    refreshCampaignCounts(campaignId: string): Promise<void>;
    getRecentEvents(salonId: string, campaignId?: string): Promise<any[]>;
};
export declare const waUsersRepository: {
    findBySalonId(salonId: string): Promise<any[]>;
    create(salonId: string, data: {
        first_name: string;
        last_name: string;
        email: string;
        password_hash: string;
        role: string;
    }): Promise<any>;
    delete(id: string, salonId: string): Promise<boolean>;
};
//# sourceMappingURL=whatsapp.repository.d.ts.map