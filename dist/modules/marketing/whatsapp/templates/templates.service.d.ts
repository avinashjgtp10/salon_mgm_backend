export declare const templatesService: {
    getAll(salonId: string): Promise<any[]>;
    getById(id: string, salonId: string): Promise<any>;
    create(salonId: string, data: any): Promise<any>;
    syncStatus(id: string, salonId: string): Promise<any>;
    delete(id: string, salonId: string): Promise<{
        message: string;
    }>;
};
//# sourceMappingURL=templates.service.d.ts.map