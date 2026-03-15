import { CreateSalonBody, UpdateSalonBody, Salon } from "./salons.types";
export declare const salonsRepository: {
    findById(id: string): Promise<Salon | null>;
    findBySlug(slug: string): Promise<Salon | null>;
    findByOwnerId(ownerId: string): Promise<Salon | null>;
    listAll(): Promise<Salon[]>;
    create(ownerId: string, data: CreateSalonBody): Promise<Salon>;
    update(id: string, patch: UpdateSalonBody): Promise<Salon>;
};
//# sourceMappingURL=salons.repository.d.ts.map