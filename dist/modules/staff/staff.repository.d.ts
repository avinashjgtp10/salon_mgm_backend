import { CreateStaffAddressBody, CreateStaffBody, CreateEmergencyContactBody, CreateStaffLeaveBody, Staff, StaffAddress, StaffEmergencyContact, StaffLeave, StaffListQuery, UpdateStaffAddressBody, UpdateStaffBody, UpdateEmergencyContactBody, UpdateStaffLeaveBody } from "./staff.types";
export declare const staffRepository: {
    findById(id: string, salonId: string): Promise<Staff | null>;
    list(salonId: string, q: StaffListQuery): Promise<{
        data: Staff[];
        total: number;
    }>;
    create(salonId: string, data: CreateStaffBody): Promise<Staff>;
    update(id: string, salonId: string, patch: UpdateStaffBody): Promise<Staff>;
    deactivate(id: string, salonId: string): Promise<boolean>;
    exportForDownload(salonId: string, q: Omit<StaffListQuery, "page" | "limit">): Promise<Record<string, unknown>[]>;
};
export declare const staffAddressRepository: {
    listByStaffId(staffId: string): Promise<StaffAddress[]>;
    findById(id: string, staffId: string): Promise<StaffAddress | null>;
    create(staffId: string, data: CreateStaffAddressBody): Promise<StaffAddress>;
    update(id: string, staffId: string, patch: UpdateStaffAddressBody): Promise<StaffAddress | null>;
    delete(id: string, staffId: string): Promise<boolean>;
};
export declare const staffEmergencyContactRepository: {
    listByStaffId(staffId: string): Promise<StaffEmergencyContact[]>;
    findById(id: string, staffId: string): Promise<StaffEmergencyContact | null>;
    create(staffId: string, data: CreateEmergencyContactBody): Promise<StaffEmergencyContact>;
    update(id: string, staffId: string, patch: UpdateEmergencyContactBody): Promise<StaffEmergencyContact | null>;
    delete(id: string, staffId: string): Promise<boolean>;
};
export declare const staffLeavesRepository: {
    listByStaffId(staffId: string, from?: string, to?: string): Promise<StaffLeave[]>;
    findById(id: string, staffId: string): Promise<StaffLeave | null>;
    create(staffId: string, data: CreateStaffLeaveBody): Promise<StaffLeave>;
    update(id: string, staffId: string, patch: UpdateStaffLeaveBody): Promise<StaffLeave | null>;
    delete(id: string, staffId: string): Promise<boolean>;
};
//# sourceMappingURL=staff.repository.d.ts.map