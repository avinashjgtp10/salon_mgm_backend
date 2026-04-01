export declare const templatesRepo: {
    findAll(salonId: string): Promise<any[]>;
    findById(id: string, salonId: string): Promise<any>;
    create(salonId: string, data: {
        name: string;
        category: string;
        language: string;
        header_type: string;
        header_text?: string;
        header_media_id?: string;
        body_text: string;
        footer_text?: string;
        buttons: any[];
        meta_template_id?: string;
        status?: string;
    }): Promise<any>;
    updateStatus(id: string, status: string, metaTemplateId?: string, rejectionReason?: string): Promise<any>;
    delete(id: string, salonId: string): Promise<boolean>;
};
//# sourceMappingURL=templates.repository.d.ts.map