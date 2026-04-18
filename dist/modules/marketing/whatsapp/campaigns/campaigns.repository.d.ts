import { WACampaign, WACampaignContact } from './campaigns.types';
export declare const campaignsRepository: {
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
//# sourceMappingURL=campaigns.repository.d.ts.map