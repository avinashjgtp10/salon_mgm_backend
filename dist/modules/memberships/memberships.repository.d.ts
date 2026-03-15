import { Membership, CreateMembershipDTO, UpdateMembershipDTO, MembershipsListQuery } from "./memberships.types";
export declare const membershipsRepository: {
    list(_q: MembershipsListQuery): Promise<{
        items: Membership[];
        total: number;
    }>;
    findById(id: string): Promise<Membership | null>;
    create(data: CreateMembershipDTO): Promise<Membership>;
    update(id: string, data: UpdateMembershipDTO): Promise<Membership | null>;
    delete(id: string): Promise<boolean>;
};
//# sourceMappingURL=memberships.repository.d.ts.map