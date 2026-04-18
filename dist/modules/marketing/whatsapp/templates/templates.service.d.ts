import { CreateTemplateBody } from './templates.types';
export declare const templatesService: {
    getAll(salonId: string): Promise<import("./templates.types").WATemplate[]>;
    getById(id: string, salonId: string): Promise<import("./templates.types").WATemplate>;
    create(salonId: string, body: CreateTemplateBody): Promise<import("./templates.types").WATemplate>;
    syncStatus(id: string, salonId: string): Promise<import("./templates.types").WATemplate>;
    delete(id: string, salonId: string): Promise<{
        message: string;
    }>;
};
//# sourceMappingURL=templates.service.d.ts.map