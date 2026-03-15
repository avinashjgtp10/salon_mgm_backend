import { CreateSalonBody, UpdateSalonBody, Salon } from "./salons.types";
export declare const salonsService: {
    create(ownerId: string, body: CreateSalonBody): Promise<Salon>;
    mySalon(ownerId: string): Promise<Salon>;
    getById(id: string): Promise<Salon>;
    listAll(): Promise<Salon[]>;
    updateByOwnerOrAdmin(params: {
        salonId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateSalonBody;
    }): Promise<Salon>;
};
//# sourceMappingURL=salons.service.d.ts.map