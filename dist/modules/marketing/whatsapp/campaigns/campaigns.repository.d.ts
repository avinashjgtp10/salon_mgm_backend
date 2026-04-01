export declare const campaignsRepo: {
    findAll(salonId: string): Promise<any[]>;
    findById(id: string, salonId: string): Promise<any>;
    create(salonId: string, templateId: string, name: string, batchSize: number, totalContacts: number): Promise<string>;
    bulkInsertContacts(campaignId: string, contacts: any[]): Promise<void>;
    getContactIds(campaignId: string): Promise<any[]>;
    getPendingContactIds(campaignId: string): Promise<any[]>;
    updateStatus(id: string, status: string): Promise<any>;
    getContacts(campaignId: string, status?: string): Promise<any[]>;
    getReport(campaignId: string, type: string): Promise<any[]>;
};
//# sourceMappingURL=campaigns.repository.d.ts.map