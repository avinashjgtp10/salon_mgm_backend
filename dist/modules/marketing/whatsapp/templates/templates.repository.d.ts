import { WATemplate, CreateTemplateBody } from './templates.types';
export declare const templatesRepository: {
    findAll(salonId: string): Promise<WATemplate[]>;
    findById(id: string, salonId: string): Promise<WATemplate | null>;
    create(salonId: string, body: CreateTemplateBody & {
        meta_template_id?: string | null;
        status?: string;
    }): Promise<WATemplate>;
    updateStatus(id: string, status: string, metaTemplateId?: string | null, rejectionReason?: string | null): Promise<WATemplate>;
    delete(id: string, salonId: string): Promise<boolean>;
};
//# sourceMappingURL=templates.repository.d.ts.map