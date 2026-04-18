import { CreateCampaignBody } from './campaigns.types';
export declare const campaignsService: {
    getAll(salonId: string): Promise<import("./campaigns.types").WACampaign[]>;
    getById(id: string, salonId: string): Promise<import("./campaigns.types").WACampaign>;
    create(salonId: string, body: CreateCampaignBody): Promise<import("./campaigns.types").WACampaign | null>;
    pause(id: string, salonId: string): Promise<import("./campaigns.types").WACampaign>;
    resume(id: string, salonId: string): Promise<import("./campaigns.types").WACampaign>;
    getContacts(id: string, salonId: string, status?: string): Promise<import("./campaigns.types").WACampaignContact[]>;
    getReport(id: string, salonId: string, type: string): Promise<import("./campaigns.types").WACampaignContact[]>;
};
//# sourceMappingURL=campaigns.service.d.ts.map