import { Request, Response, NextFunction } from "express";
import { StaffListQuery } from "./staff.types";
type AuthRequest = Request & {
    user?: {
        userId: string;
        role?: string;
    };
};
export declare const staffController: {
    list(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    create(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    update(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    deactivate(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    /** Build export query params from the request (no pagination) */
    _buildExportQuery(req: Request): Omit<StaffListQuery, "page" | "limit">;
    /** Column definitions — ordered with first_name / last_name first */
    _exportFields: readonly [{
        readonly label: "First Name";
        readonly value: "first_name";
    }, {
        readonly label: "Last Name";
        readonly value: "last_name";
    }, {
        readonly label: "Email";
        readonly value: "email";
    }, {
        readonly label: "Phone";
        readonly value: "phone";
    }, {
        readonly label: "Phone Country Code";
        readonly value: "phone_country_code";
    }, {
        readonly label: "Additional Phone";
        readonly value: "additional_phone";
    }, {
        readonly label: "Employee Code";
        readonly value: "employee_code";
    }, {
        readonly label: "Designation";
        readonly value: "designation";
    }, {
        readonly label: "Employment Type";
        readonly value: "employment_type";
    }, {
        readonly label: "Active";
        readonly value: "is_active";
    }, {
        readonly label: "Invitation Status";
        readonly value: "invitation_status";
    }, {
        readonly label: "Branch ID";
        readonly value: "branch_id";
    }, {
        readonly label: "Country";
        readonly value: "country";
    }, {
        readonly label: "Calendar Color";
        readonly value: "calendar_color";
    }, {
        readonly label: "Experience (Years)";
        readonly value: "experience_years";
    }, {
        readonly label: "Specialization";
        readonly value: "specialization";
    }, {
        readonly label: "Commission Type";
        readonly value: "commission_type";
    }, {
        readonly label: "Commission Value";
        readonly value: "commission_value";
    }, {
        readonly label: "Joined Date";
        readonly value: "joined_date";
    }, {
        readonly label: "Birthday Day";
        readonly value: "birthday_day";
    }, {
        readonly label: "Birthday Month";
        readonly value: "birthday_month";
    }, {
        readonly label: "Start Date Day";
        readonly value: "start_date_day";
    }, {
        readonly label: "Start Date Month";
        readonly value: "start_date_month";
    }, {
        readonly label: "Start Year";
        readonly value: "start_year";
    }, {
        readonly label: "End Date Day";
        readonly value: "end_date_day";
    }, {
        readonly label: "End Date Month";
        readonly value: "end_date_month";
    }, {
        readonly label: "End Year";
        readonly value: "end_year";
    }, {
        readonly label: "Staff External ID";
        readonly value: "staff_external_id";
    }, {
        readonly label: "Notes";
        readonly value: "notes";
    }, {
        readonly label: "Created At";
        readonly value: "created_at";
    }];
    exportExcel(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    exportCsv(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export declare const staffInvitationController: {
    verifyToken(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    acceptInvitation(req: Request, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    resendInvitation(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    cancelInvitation(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export declare const staffAddressController: {
    list(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    create(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    update(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    delete(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export declare const staffEmergencyContactController: {
    list(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    create(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    update(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    delete(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export declare const staffWagesController: {
    get(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    upsert(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export declare const staffCommissionsController: {
    list(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    upsert(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export declare const staffPayRunsController: {
    get(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    upsert(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export declare const staffSchedulesController: {
    list(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    upsert(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export declare const staffLeavesController: {
    list(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    create(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    update(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
    delete(req: AuthRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
};
export {};
//# sourceMappingURL=staff.controller.d.ts.map