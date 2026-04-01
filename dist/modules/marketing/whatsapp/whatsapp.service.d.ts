export declare const whatsappService: {
    getSalonConfig(salonId: string): Promise<any>;
    sendTemplateMessage(params: {
        phoneNumberId: string;
        accessToken: string;
        to: string;
        templateName: string;
        language: string;
        components: any[];
    }): Promise<any>;
    submitTemplate(params: {
        wabaId: string;
        accessToken: string;
        name: string;
        category: string;
        language: string;
        components: any[];
    }): Promise<any>;
    getTemplateStatus(accessToken: string, metaTemplateId: string): Promise<any>;
};
//# sourceMappingURL=whatsapp.service.d.ts.map