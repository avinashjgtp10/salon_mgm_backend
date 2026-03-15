import { StaffWageSettings, StaffCommissionSettings, StaffPayRunSettings, StaffSchedule, UpdateWageSettingsBody, UpdateCommissionBody, UpdatePayRunBody, UpsertStaffSchedulesBody, CommissionCategory } from "./staff.types";
export declare const staffWagesRepository: {
    findByStaffId(staffId: string): Promise<StaffWageSettings | null>;
    upsert(staffId: string, data: UpdateWageSettingsBody): Promise<StaffWageSettings>;
};
export declare const staffCommissionsRepository: {
    listByStaffId(staffId: string): Promise<StaffCommissionSettings[]>;
    findByCategory(staffId: string, category: CommissionCategory): Promise<StaffCommissionSettings | null>;
    upsert(staffId: string, data: UpdateCommissionBody): Promise<StaffCommissionSettings>;
};
export declare const staffPayRunsRepository: {
    findByStaffId(staffId: string): Promise<StaffPayRunSettings | null>;
    upsert(staffId: string, data: UpdatePayRunBody): Promise<StaffPayRunSettings>;
};
export declare const staffSchedulesRepository: {
    listByStaffId(staffId: string): Promise<StaffSchedule[]>;
    upsertBulk(staffId: string, body: UpsertStaffSchedulesBody): Promise<StaffSchedule[]>;
};
//# sourceMappingURL=staffSettings.repository.d.ts.map