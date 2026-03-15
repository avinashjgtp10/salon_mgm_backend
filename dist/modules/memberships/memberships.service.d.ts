import { CreateMembershipDTO, UpdateMembershipDTO, MembershipsListQuery } from "./memberships.types";
export declare const membershipsService: {
    list(query: MembershipsListQuery): Promise<{
        items: import("./memberships.types").Membership[];
        total: number;
    }>;
    create(data: CreateMembershipDTO): Promise<import("./memberships.types").Membership>;
    getById(id: string): Promise<import("./memberships.types").Membership>;
    update(id: string, data: UpdateMembershipDTO): Promise<import("./memberships.types").Membership>;
    delete(id: string): Promise<{
        message: string;
    }>;
};
//# sourceMappingURL=memberships.service.d.ts.map