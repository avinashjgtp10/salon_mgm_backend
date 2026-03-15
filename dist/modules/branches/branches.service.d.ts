import { Branch, BranchHoliday, BranchTiming, CreateBranchBody, TimingDayInput, UpdateBranchBody } from "./branches.types";
export declare const branchesService: {
    createBranch(salonId: string, body: CreateBranchBody): Promise<Branch>;
    listBranchesBySalon(salonId: string): Promise<Branch[]>;
    getBranchById(id: string): Promise<Branch>;
    updateBranch(branchId: string, patch: UpdateBranchBody): Promise<Branch>;
    getTimings(branchId: string): Promise<BranchTiming[]>;
    setTimings(branchId: string, days: TimingDayInput[]): Promise<BranchTiming[]>;
    replaceTimings(branchId: string, days: TimingDayInput[]): Promise<BranchTiming[]>;
    createHoliday(branchId: string, holidayDate: string, reason?: string): Promise<BranchHoliday>;
    listHolidays(branchId: string, from?: string, to?: string): Promise<BranchHoliday[]>;
    deleteHoliday(holidayId: string): Promise<void>;
};
//# sourceMappingURL=branches.service.d.ts.map