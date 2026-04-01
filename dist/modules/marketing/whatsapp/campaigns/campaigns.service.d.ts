export declare const campaignsService: {
    getAll(salonId: string): Promise<any[]>;
    getById(id: string, salonId: string): Promise<any>;
    create(salonId: string, data: {
        name: string;
        templateId: string;
        batchSize: number;
        contacts: any[];
    }): Promise<any>;
    pause(id: string, salonId: string): Promise<any>;
    resume(id: string, salonId: string): Promise<any>;
    getContacts(id: string, salonId: string, status?: string): Promise<any[]>;
    getReport(id: string, salonId: string, type: string): Promise<any[]>;
};
//# sourceMappingURL=campaigns.service.d.ts.map