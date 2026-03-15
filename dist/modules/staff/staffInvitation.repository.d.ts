import { StaffInvitation } from "./staff.types";
export declare const staffInvitationRepository: {
    findByStaffId(staffId: string): Promise<StaffInvitation | null>;
    findByToken(token: string): Promise<StaffInvitation | null>;
    create(staffId: string, email: string): Promise<StaffInvitation>;
    markExpired(staffId: string): Promise<void>;
    markCancelled(staffId: string): Promise<void>;
    markAccepted(token: string): Promise<StaffInvitation | null>;
};
//# sourceMappingURL=staffInvitation.repository.d.ts.map