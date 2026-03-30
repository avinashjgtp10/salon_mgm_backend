export type WATemplateStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type WATemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
export type WAHeaderType = 'none' | 'text' | 'image' | 'video' | 'document';
export type WAButton = {
    type: 'quick_reply' | 'url' | 'phone';
    text: string;
    value?: string;
};
export type WATemplate = {
    id: string;
    salon_id: string;
    name: string;
    category: WATemplateCategory;
    language: string;
    status: WATemplateStatus;
    header_type: WAHeaderType;
    header_text: string | null;
    header_media_id: string | null;
    body_text: string;
    footer_text: string | null;
    buttons: WAButton[];
    meta_template_id: string | null;
    rejection_reason: string | null;
    approved_at: string | null;
    created_at: string;
    updated_at: string;
};
export type CreateTemplateBody = {
    name: string;
    category: WATemplateCategory;
    language: string;
    header_type: WAHeaderType;
    header_text?: string | null;
    body_text: string;
    footer_text?: string | null;
    buttons?: WAButton[];
};
//# sourceMappingURL=templates.types.d.ts.map