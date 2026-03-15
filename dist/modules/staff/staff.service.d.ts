import { Staff, StaffAddress, StaffEmergencyContact, StaffLeave, StaffSchedule, StaffWageSettings, StaffCommissionSettings, StaffPayRunSettings, CreateStaffBody, UpdateStaffBody, CreateStaffAddressBody, UpdateStaffAddressBody, CreateEmergencyContactBody, UpdateEmergencyContactBody, CreateStaffLeaveBody, UpdateStaffLeaveBody, UpdateWageSettingsBody, UpdateCommissionBody, UpdatePayRunBody, UpsertStaffSchedulesBody, AcceptInvitationBody, StaffListQuery } from "./staff.types";
export declare const staffService: {
    list(salonId: string, query: StaffListQuery): Promise<{
        data: Staff[];
        total: number;
    }>;
    exportStaff(salonId: string, query: Omit<StaffListQuery, "page" | "limit">): Promise<Record<string, unknown>[]>;
    getById(id: string, salonId: string): Promise<Staff>;
    create(params: {
        salonId: string;
        requesterUserId: string;
        requesterRole?: string;
        body: CreateStaffBody;
    }): Promise<{
        staffId: string;
    }>;
    update(params: {
        id: string;
        salonId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateStaffBody;
    }): Promise<Staff>;
    deactivate(params: {
        id: string;
        salonId: string;
        requesterUserId: string;
        requesterRole?: string;
    }): Promise<void>;
};
export declare const staffInvitationService: {
    verifyToken(token: string): Promise<{
        valid: boolean;
        expired: boolean;
        email?: undefined;
    } | {
        valid: boolean;
        email: string;
        expired: boolean;
    }>;
    acceptInvitation(body: AcceptInvitationBody): Promise<{
        staffId: string;
    }>;
    resendInvitation(params: {
        staffId: string;
        salonId: string;
        salonName?: string;
    }): Promise<void>;
    cancelInvitation(params: {
        staffId: string;
        salonId: string;
    }): Promise<void>;
};
export declare const staffAddressService: {
    list(staffId: string, salonId: string): Promise<StaffAddress[]>;
    create(staffId: string, salonId: string, data: CreateStaffAddressBody): Promise<StaffAddress>;
    update(staffId: string, salonId: string, id: string, patch: UpdateStaffAddressBody): Promise<StaffAddress>;
    delete(staffId: string, salonId: string, id: string): Promise<void>;
};
export declare const staffEmergencyContactService: {
    list(staffId: string, salonId: string): Promise<StaffEmergencyContact[]>;
    create(staffId: string, salonId: string, data: CreateEmergencyContactBody): Promise<StaffEmergencyContact>;
    update(staffId: string, salonId: string, id: string, patch: UpdateEmergencyContactBody): Promise<StaffEmergencyContact>;
    delete(staffId: string, salonId: string, id: string): Promise<void>;
};
export declare const staffWagesService: {
    get(staffId: string, salonId: string): Promise<StaffWageSettings | null>;
    upsert(staffId: string, salonId: string, data: UpdateWageSettingsBody): Promise<StaffWageSettings>;
};
export declare const staffCommissionsService: {
    list(staffId: string, salonId: string): Promise<StaffCommissionSettings[]>;
    upsert(staffId: string, salonId: string, data: UpdateCommissionBody): Promise<StaffCommissionSettings>;
};
export declare const staffPayRunsService: {
    get(staffId: string, salonId: string): Promise<StaffPayRunSettings | null>;
    upsert(staffId: string, salonId: string, data: UpdatePayRunBody): Promise<StaffPayRunSettings>;
};
export declare const staffSchedulesService: {
    list(staffId: string, salonId: string): Promise<StaffSchedule[]>;
    upsert(staffId: string, salonId: string, body: UpsertStaffSchedulesBody): Promise<StaffSchedule[]>;
};
export declare const staffLeavesService: {
    list(staffId: string, salonId: string, from?: string, to?: string): Promise<StaffLeave[]>;
    create(staffId: string, salonId: string, data: CreateStaffLeaveBody): Promise<StaffLeave>;
    update(staffId: string, salonId: string, id: string, patch: UpdateStaffLeaveBody): Promise<StaffLeave>;
    delete(staffId: string, salonId: string, id: string): Promise<void>;
};
//# sourceMappingURL=staff.service.d.ts.map