import { Branch, BranchHoliday, BranchTiming, CreateBranchBody, TimingDayInput, UpdateBranchBody } from "./branches.types";
export declare const branchesRepository: {
    findById(id: string): Promise<Branch | null>;
    listBySalonId(salonId: string): Promise<Branch[]>;
    unsetMainBranch(salonId: string): Promise<void>;
    create(salonId: string, data: CreateBranchBody): Promise<Branch>;
    update(id: string, patch: UpdateBranchBody): Promise<Branch>;
    listTimings(branchId: string): Promise<BranchTiming[]>;
    upsertTimings(branchId: string, days: TimingDayInput[]): Promise<BranchTiming[]>;
    replaceTimings(branchId: string, days: TimingDayInput[]): Promise<BranchTiming[]>;
    createHoliday(branchId: string, holidayDate: string, reason?: string): Promise<BranchHoliday>;
    listHolidays(branchId: string, from?: string, to?: string): Promise<BranchHoliday[]>;
    findHolidayById(id: string): Promise<BranchHoliday | null>;
    deleteHolidayById(id: string): Promise<void>;
};
//# sourceMappingURL=branches.repository.d.ts.map