"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.staffLeavesController = exports.staffSchedulesController = exports.staffPayRunsController = exports.staffCommissionsController = exports.staffWagesController = exports.staffEmergencyContactController = exports.staffAddressController = exports.staffInvitationController = exports.staffController = void 0;
const XLSX = __importStar(require("xlsx"));
const json2csv_1 = require("json2csv");
const logger_1 = __importDefault(require("../../config/logger"));
const error_middleware_1 = require("../../middleware/error.middleware");
const response_util_1 = require("../utils/response.util");
const staff_service_1 = require("./staff.service");
const salons_repository_1 = require("../salons/salons.repository");
// ─── Helper: extract & validate x-salon-id header ─────────────────────────────
const getSalonId = (req) => {
    const id = String(req.headers["x-salon-id"] ?? "").trim();
    if (!id)
        throw new error_middleware_1.AppError(400, "x-salon-id header is required", "VALIDATION_ERROR");
    return id;
};
// ─── Staff ────────────────────────────────────────────────────────────────────
exports.staffController = {
    async list(req, res, next) {
        try {
            const salonId = getSalonId(req);
            logger_1.default.info("GET /staff", { salonId });
            const query = {
                page: req.query.page ? Number(req.query.page) : undefined,
                limit: req.query.limit ? Number(req.query.limit) : undefined,
                search: req.query.search ? String(req.query.search) : undefined,
                invitation_status: req.query.invitation_status,
                employment_type: req.query.employment_type,
                is_active: req.query.is_active !== undefined
                    ? req.query.is_active === "true"
                    : undefined,
                branch_id: req.query.branch_id ? String(req.query.branch_id) : undefined,
                sort_by: req.query.sort_by,
                sort_order: req.query.sort_order,
            };
            const { data, total } = await staff_service_1.staffService.list(salonId, query);
            const page = query.page ?? 1;
            const limit = query.limit ?? 20;
            // FIX: wrap data + pagination together — sendSuccess only takes 3-4 args
            return (0, response_util_1.sendSuccess)(res, 200, {
                items: data,
                pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
            }, "Staff list fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async create(req, res, next) {
        try {
            const salonId = getSalonId(req);
            if (!req.user?.userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            logger_1.default.info("POST /staff", { salonId, userId: req.user.userId });
            const result = await staff_service_1.staffService.create({
                salonId,
                requesterUserId: req.user.userId,
                requesterRole: req.user.role,
                body: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 201, result, "Staff created and invitation sent");
        }
        catch (err) {
            return next(err);
        }
    },
    async getById(req, res, next) {
        try {
            const salonId = getSalonId(req);
            const id = String(req.params.id); // FIX: cast to string
            logger_1.default.info("GET /staff/:id", { id, salonId });
            const staff = await staff_service_1.staffService.getById(id, salonId);
            return (0, response_util_1.sendSuccess)(res, 200, staff, "Staff fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async update(req, res, next) {
        try {
            const salonId = getSalonId(req);
            if (!req.user?.userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const id = String(req.params.id); // FIX
            logger_1.default.info("PATCH /staff/:id", { id, salonId });
            const updated = await staff_service_1.staffService.update({
                id,
                salonId,
                requesterUserId: req.user.userId,
                requesterRole: req.user.role,
                patch: req.body,
            });
            return (0, response_util_1.sendSuccess)(res, 200, updated, "Staff updated successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async deactivate(req, res, next) {
        try {
            const salonId = getSalonId(req);
            if (!req.user?.userId)
                throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
            const id = String(req.params.id); // FIX
            logger_1.default.info("DELETE /staff/:id", { id, salonId });
            await staff_service_1.staffService.deactivate({
                id, salonId,
                requesterUserId: req.user.userId,
                requesterRole: req.user.role,
            });
            return (0, response_util_1.sendSuccess)(res, 200, null, "Staff deactivated");
        }
        catch (err) {
            return next(err);
        }
    },
    // ─── Export helpers ────────────────────────────────────────────────────────
    /** Build export query params from the request (no pagination) */
    _buildExportQuery(req) {
        return {
            search: req.query.search ? String(req.query.search) : undefined,
            invitation_status: req.query.invitation_status,
            employment_type: req.query.employment_type,
            is_active: req.query.is_active !== undefined
                ? req.query.is_active === "true"
                : undefined,
            branch_id: req.query.branch_id ? String(req.query.branch_id) : undefined,
            sort_by: (req.query.sort_by ?? "first_name"),
            sort_order: (req.query.sort_order ?? "ASC"),
        };
    },
    /** Column definitions — ordered with first_name / last_name first */
    _exportFields: [
        { label: "First Name", value: "first_name" },
        { label: "Last Name", value: "last_name" },
        { label: "Email", value: "email" },
        { label: "Phone", value: "phone" },
        { label: "Phone Country Code", value: "phone_country_code" },
        { label: "Additional Phone", value: "additional_phone" },
        { label: "Employee Code", value: "employee_code" },
        { label: "Designation", value: "designation" },
        { label: "Employment Type", value: "employment_type" },
        { label: "Active", value: "is_active" },
        { label: "Invitation Status", value: "invitation_status" },
        { label: "Branch ID", value: "branch_id" },
        { label: "Country", value: "country" },
        { label: "Calendar Color", value: "calendar_color" },
        { label: "Experience (Years)", value: "experience_years" },
        { label: "Specialization", value: "specialization" },
        { label: "Commission Type", value: "commission_type" },
        { label: "Commission Value", value: "commission_value" },
        { label: "Joined Date", value: "joined_date" },
        { label: "Birthday Day", value: "birthday_day" },
        { label: "Birthday Month", value: "birthday_month" },
        { label: "Start Date Day", value: "start_date_day" },
        { label: "Start Date Month", value: "start_date_month" },
        { label: "Start Year", value: "start_year" },
        { label: "End Date Day", value: "end_date_day" },
        { label: "End Date Month", value: "end_date_month" },
        { label: "End Year", value: "end_year" },
        { label: "Staff External ID", value: "staff_external_id" },
        { label: "Notes", value: "notes" },
        { label: "Created At", value: "created_at" },
    ],
    async exportExcel(req, res, next) {
        try {
            const salonId = await resolveExportSalonId(req);
            logger_1.default.info("GET /staff/export/excel", { salonId });
            const rows = await staff_service_1.staffService.exportStaff(salonId, exports.staffController._buildExportQuery(req));
            // Build worksheet data: header row + data rows
            const headers = exports.staffController._exportFields.map(f => f.label);
            const data = rows.map(row => exports.staffController._exportFields.map(f => {
                const val = row[f.value];
                return Array.isArray(val) ? val.join(", ") : (val ?? "");
            }));
            const wsData = [headers, ...data];
            const ws = XLSX.utils.aoa_to_sheet(wsData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Staff");
            const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
            res.setHeader("Content-Disposition", "attachment; filename=\"staff_export.xlsx\"");
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            return res.status(200).send(buffer);
        }
        catch (err) {
            return next(err);
        }
    },
    async exportCsv(req, res, next) {
        try {
            const salonId = await resolveExportSalonId(req);
            logger_1.default.info("GET /staff/export/csv", { salonId });
            const rows = await staff_service_1.staffService.exportStaff(salonId, exports.staffController._buildExportQuery(req));
            // Flatten specialization array for CSV
            const flatRows = rows.map(row => {
                const r = { ...row };
                if (Array.isArray(r.specialization))
                    r.specialization = r.specialization.join(", ");
                return r;
            });
            const fields = exports.staffController._exportFields.map(f => ({ label: f.label, value: f.value }));
            const parser = new json2csv_1.Parser({ fields });
            const csv = flatRows.length ? parser.parse(flatRows) : fields.map(f => f.label).join(",");
            res.setHeader("Content-Disposition", "attachment; filename=\"staff_export.csv\"");
            res.setHeader("Content-Type", "text/csv");
            return res.status(200).send(csv);
        }
        catch (err) {
            return next(err);
        }
    },
};
// ─── Helper: resolve salon ID for export without requiring header ─────────────
// Priority: 1) x-salon-id header  2) salon owned by the token's userId
async function resolveExportSalonId(req) {
    // If the header is present, use it (same as other endpoints)
    const fromHeader = String(req.headers["x-salon-id"] ?? "").trim();
    if (fromHeader)
        return fromHeader;
    // Fall back: look up the salon owned by the authenticated user
    const userId = req.user?.userId;
    if (!userId)
        throw new error_middleware_1.AppError(401, "Unauthorized", "UNAUTHORIZED");
    const salon = await salons_repository_1.salonsRepository.findByOwnerId(userId);
    if (!salon)
        throw new error_middleware_1.AppError(404, "No salon found for this account. Please provide x-salon-id header.", "NOT_FOUND");
    return salon.id;
}
// ─── Invitations ──────────────────────────────────────────────────────────────
exports.staffInvitationController = {
    async verifyToken(req, res, next) {
        try {
            const token = String(req.params.token); // FIX
            if (!token)
                throw new error_middleware_1.AppError(400, "token is required", "VALIDATION_ERROR");
            const result = await staff_service_1.staffInvitationService.verifyToken(token);
            return (0, response_util_1.sendSuccess)(res, 200, result, "Token verified");
        }
        catch (err) {
            return next(err);
        }
    },
    async acceptInvitation(req, res, next) {
        try {
            const result = await staff_service_1.staffInvitationService.acceptInvitation(req.body);
            return (0, response_util_1.sendSuccess)(res, 200, result, "Invitation accepted. You can now log in.");
        }
        catch (err) {
            return next(err);
        }
    },
    async resendInvitation(req, res, next) {
        try {
            const salonId = getSalonId(req);
            const staffId = String(req.params.id); // FIX
            await staff_service_1.staffInvitationService.resendInvitation({
                staffId, salonId, salonName: req.body?.salon_name,
            });
            return (0, response_util_1.sendSuccess)(res, 200, null, "Invitation resent");
        }
        catch (err) {
            return next(err);
        }
    },
    async cancelInvitation(req, res, next) {
        try {
            const salonId = getSalonId(req);
            const staffId = String(req.params.id); // FIX
            await staff_service_1.staffInvitationService.cancelInvitation({ staffId, salonId });
            return (0, response_util_1.sendSuccess)(res, 200, null, "Invitation cancelled");
        }
        catch (err) {
            return next(err);
        }
    },
};
// ─── Addresses ────────────────────────────────────────────────────────────────
exports.staffAddressController = {
    async list(req, res, next) {
        try {
            const data = await staff_service_1.staffAddressService.list(String(req.params.staffId), getSalonId(req));
            return (0, response_util_1.sendSuccess)(res, 200, data, "Addresses fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async create(req, res, next) {
        try {
            const data = await staff_service_1.staffAddressService.create(String(req.params.staffId), getSalonId(req), req.body);
            return (0, response_util_1.sendSuccess)(res, 201, data, "Address created successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async update(req, res, next) {
        try {
            const data = await staff_service_1.staffAddressService.update(String(req.params.staffId), getSalonId(req), String(req.params.id), req.body);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Address updated successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async delete(req, res, next) {
        try {
            await staff_service_1.staffAddressService.delete(String(req.params.staffId), getSalonId(req), String(req.params.id));
            return (0, response_util_1.sendSuccess)(res, 200, null, "Address deleted");
        }
        catch (err) {
            return next(err);
        }
    },
};
// ─── Emergency Contacts ───────────────────────────────────────────────────────
exports.staffEmergencyContactController = {
    async list(req, res, next) {
        try {
            const data = await staff_service_1.staffEmergencyContactService.list(String(req.params.staffId), getSalonId(req));
            return (0, response_util_1.sendSuccess)(res, 200, data, "Emergency contacts fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async create(req, res, next) {
        try {
            const data = await staff_service_1.staffEmergencyContactService.create(String(req.params.staffId), getSalonId(req), req.body);
            return (0, response_util_1.sendSuccess)(res, 201, data, "Emergency contact created successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async update(req, res, next) {
        try {
            const data = await staff_service_1.staffEmergencyContactService.update(String(req.params.staffId), getSalonId(req), String(req.params.id), req.body);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Emergency contact updated successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async delete(req, res, next) {
        try {
            await staff_service_1.staffEmergencyContactService.delete(String(req.params.staffId), getSalonId(req), String(req.params.id));
            return (0, response_util_1.sendSuccess)(res, 200, null, "Emergency contact deleted");
        }
        catch (err) {
            return next(err);
        }
    },
};
// ─── Wages ────────────────────────────────────────────────────────────────────
exports.staffWagesController = {
    async get(req, res, next) {
        try {
            const data = await staff_service_1.staffWagesService.get(String(req.params.staffId), getSalonId(req));
            return (0, response_util_1.sendSuccess)(res, 200, data, "Wage settings fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async upsert(req, res, next) {
        try {
            const data = await staff_service_1.staffWagesService.upsert(String(req.params.staffId), getSalonId(req), req.body);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Wage settings updated successfully");
        }
        catch (err) {
            return next(err);
        }
    },
};
// ─── Commissions ──────────────────────────────────────────────────────────────
exports.staffCommissionsController = {
    async list(req, res, next) {
        try {
            const data = await staff_service_1.staffCommissionsService.list(String(req.params.staffId), getSalonId(req));
            return (0, response_util_1.sendSuccess)(res, 200, data, "Commission settings fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async upsert(req, res, next) {
        try {
            const data = await staff_service_1.staffCommissionsService.upsert(String(req.params.staffId), getSalonId(req), req.body);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Commission setting updated successfully");
        }
        catch (err) {
            return next(err);
        }
    },
};
// ─── Pay Runs ─────────────────────────────────────────────────────────────────
exports.staffPayRunsController = {
    async get(req, res, next) {
        try {
            const data = await staff_service_1.staffPayRunsService.get(String(req.params.staffId), getSalonId(req));
            return (0, response_util_1.sendSuccess)(res, 200, data, "Pay run settings fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async upsert(req, res, next) {
        try {
            const data = await staff_service_1.staffPayRunsService.upsert(String(req.params.staffId), getSalonId(req), req.body);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Pay run settings updated successfully");
        }
        catch (err) {
            return next(err);
        }
    },
};
// ─── Schedules ────────────────────────────────────────────────────────────────
exports.staffSchedulesController = {
    async list(req, res, next) {
        try {
            const data = await staff_service_1.staffSchedulesService.list(String(req.params.staffId), getSalonId(req));
            return (0, response_util_1.sendSuccess)(res, 200, data, "Schedules fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async upsert(req, res, next) {
        try {
            const data = await staff_service_1.staffSchedulesService.upsert(String(req.params.staffId), getSalonId(req), req.body);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Schedules updated successfully");
        }
        catch (err) {
            return next(err);
        }
    },
};
// ─── Leaves ───────────────────────────────────────────────────────────────────
exports.staffLeavesController = {
    async list(req, res, next) {
        try {
            const data = await staff_service_1.staffLeavesService.list(String(req.params.staffId), getSalonId(req), req.query.from ? String(req.query.from) : undefined, req.query.to ? String(req.query.to) : undefined);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Leaves fetched successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async create(req, res, next) {
        try {
            const data = await staff_service_1.staffLeavesService.create(String(req.params.staffId), getSalonId(req), req.body);
            return (0, response_util_1.sendSuccess)(res, 201, data, "Leave created successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async update(req, res, next) {
        try {
            const data = await staff_service_1.staffLeavesService.update(String(req.params.staffId), getSalonId(req), String(req.params.id), req.body);
            return (0, response_util_1.sendSuccess)(res, 200, data, "Leave updated successfully");
        }
        catch (err) {
            return next(err);
        }
    },
    async delete(req, res, next) {
        try {
            await staff_service_1.staffLeavesService.delete(String(req.params.staffId), getSalonId(req), String(req.params.id));
            return (0, response_util_1.sendSuccess)(res, 200, null, "Leave deleted");
        }
        catch (err) {
            return next(err);
        }
    },
};
//# sourceMappingURL=staff.controller.js.map