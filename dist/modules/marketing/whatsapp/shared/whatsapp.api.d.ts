export declare const whatsappMetaApi: {
    sendTemplateMessage(params: {
        phoneNumberId: string;
        accessToken: string;
        to: string;
        templateName: string;
        language: string;
        components: any[];
    }): Promise<{
        messages: Array<{
            id: string;
        }>;
    }>;
    submitTemplate(params: {
        wabaId: string;
        accessToken: string;
        name: string;
        category: string;
        language: string;
        components: any[];
    }): Promise<{
        id: string;
        status?: string;
    }>;
    getTemplateStatus(accessToken: string, templateId: string): Promise<{
        status: string;
        rejected_reason?: string;
    }>;
    testConnection(phoneNumberId: string, accessToken: string): Promise<{
        display_phone_number: string;
        quality_rating?: string;
        messaging_limit_tier?: number;
    }>;
};
//# sourceMappingURL=whatsapp.api.d.ts.map