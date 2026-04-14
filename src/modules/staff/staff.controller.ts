import { Request, Response, NextFunction } from "express";
import * as XLSX from "xlsx";
import { Parser as CsvParser } from "json2csv";
import logger from "../../config/logger";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import {
  staffService, staffInvitationService, staffAddressService,
  staffEmergencyContactService, staffWagesService, staffCommissionsService,
  staffPayRunsService, staffSchedulesService, staffLeavesService,
} from "./staff.service";
import { salonsRepository } from "../salons/salons.repository";
import {
  CreateStaffBody, UpdateStaffBody, CreateStaffAddressBody, UpdateStaffAddressBody,
  CreateEmergencyContactBody, UpdateEmergencyContactBody, UpdateWageSettingsBody,
  UpdateCommissionBody, UpdatePayRunBody, UpsertStaffSchedulesBody,
  CreateStaffLeaveBody, UpdateStaffLeaveBody, AcceptInvitationBody, StaffListQuery,
} from "./staff.types";

type AuthRequest = Request & { user?: { userId: string; role?: string } };

// ─── Helper: extract & validate x-salon-id header ─────────────────────────────

const getSalonId = (req: Request): string => {
  const id = String(req.headers["x-salon-id"] ?? "").trim();
  if (!id) throw new AppError(400, "x-salon-id header is required", "VALIDATION_ERROR");
  return id;
};

// ─── Staff ────────────────────────────────────────────────────────────────────

export const staffController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      logger.info("GET /staff", { salonId });

      const query: StaffListQuery = {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
        invitation_status: req.query.invitation_status as any,
        employment_type: req.query.employment_type as any,
        is_active: req.query.is_active !== undefined
          ? req.query.is_active === "true"
          : undefined,
        branch_id: req.query.branch_id ? String(req.query.branch_id) : undefined,
        sort_by: req.query.sort_by as any,
        sort_order: req.query.sort_order as any,
      };

      const { data, total } = await staffService.list(salonId, query);
      const page = query.page ?? 1;
      const limit = query.limit ?? 20;

      // FIX: wrap data + pagination together — sendSuccess only takes 3-4 args
      return sendSuccess(res, 200, {
        items: data,
        pagination: { total, page, limit, total_pages: Math.ceil(total / limit) },
      }, "Staff list fetched successfully");
    } catch (err) { return next(err); }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      logger.info("POST /staff", { salonId, userId: req.user.userId });

      const result = await staffService.create({
        salonId,
        requesterUserId: req.user.userId,
        requesterRole: req.user.role,
        body: req.body as CreateStaffBody,
      });
      return sendSuccess(res, 201, result, "Staff created and invitation sent");
    } catch (err) { return next(err); }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const id = String(req.params.id); // FIX: cast to string
      logger.info("GET /staff/:id", { id, salonId });

      const staff = await staffService.getById(id, salonId);
      return sendSuccess(res, 200, staff, "Staff fetched successfully");
    } catch (err) { return next(err); }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      const id = String(req.params.id); // FIX
      logger.info("PATCH /staff/:id", { id, salonId });

      const updated = await staffService.update({
        id,
        salonId,
        requesterUserId: req.user.userId,
        requesterRole: req.user.role,
        patch: req.body as UpdateStaffBody,
      });
      return sendSuccess(res, 200, updated, "Staff updated successfully");
    } catch (err) { return next(err); }
  },

  async deactivate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      if (!req.user?.userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
      const id = String(req.params.id); // FIX
      logger.info("DELETE /staff/:id", { id, salonId });

      await staffService.deactivate({
        id, salonId,
        requesterUserId: req.user.userId,
        requesterRole: req.user.role,
      });
      return sendSuccess(res, 200, null, "Staff deactivated");
    } catch (err) { return next(err); }
  },

  // ─── Export helpers ────────────────────────────────────────────────────────

  /** Build export query params from the request (no pagination) */
  _buildExportQuery(req: Request): Omit<StaffListQuery, "page" | "limit"> {
    return {
      search: req.query.search ? String(req.query.search) : undefined,
      invitation_status: req.query.invitation_status as any,
      employment_type: req.query.employment_type as any,
      is_active: req.query.is_active !== undefined
        ? req.query.is_active === "true"
        : undefined,
      branch_id: req.query.branch_id ? String(req.query.branch_id) : undefined,
      sort_by: (req.query.sort_by ?? "first_name") as any,
      sort_order: (req.query.sort_order ?? "ASC") as any,
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
  ] as const,

  async exportExcel(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await resolveExportSalonId(req);
      logger.info("GET /staff/export/excel", { salonId });

      const rows = await staffService.exportStaff(salonId, staffController._buildExportQuery(req));

      // Build worksheet data: header row + data rows
      const headers = staffController._exportFields.map(f => f.label);
      const data = rows.map(row =>
        staffController._exportFields.map(f => {
          const val = (row as any)[f.value];
          return Array.isArray(val) ? val.join(", ") : (val ?? "");
        })
      );

      const wsData = [headers, ...data];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Staff");

      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      res.setHeader("Content-Disposition", "attachment; filename=\"staff_export.xlsx\"");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      return res.status(200).send(buffer);
    } catch (err) { return next(err); }
  },

  async exportCsv(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = await resolveExportSalonId(req);
      logger.info("GET /staff/export/csv", { salonId });

      const rows = await staffService.exportStaff(salonId, staffController._buildExportQuery(req));

      // Flatten specialization array for CSV
      const flatRows = rows.map(row => {
        const r: Record<string, unknown> = { ...row as any };
        if (Array.isArray(r.specialization)) r.specialization = (r.specialization as string[]).join(", ");
        return r;
      });

      const fields = staffController._exportFields.map(f => ({ label: f.label, value: f.value as string }));
      const parser = new CsvParser({ fields });
      const csv = flatRows.length ? parser.parse(flatRows) : fields.map(f => f.label).join(",");

      res.setHeader("Content-Disposition", "attachment; filename=\"staff_export.csv\"");
      res.setHeader("Content-Type", "text/csv");
      return res.status(200).send(csv);
    } catch (err) { return next(err); }
  },
};

// ─── Helper: resolve salon ID for export without requiring header ─────────────
// Priority: 1) x-salon-id header  2) salon owned by the token's userId
async function resolveExportSalonId(req: AuthRequest): Promise<string> {
  // If the header is present, use it (same as other endpoints)
  const fromHeader = String(req.headers["x-salon-id"] ?? "").trim();
  if (fromHeader) return fromHeader;

  // Fall back: look up the salon owned by the authenticated user
  const userId = req.user?.userId;
  if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

  const salon = await salonsRepository.findByOwnerId(userId);
  if (!salon) throw new AppError(404, "No salon found for this account. Please provide x-salon-id header.", "NOT_FOUND");

  return salon.id;
}

// ─── Invitations ──────────────────────────────────────────────────────────────

export const staffInvitationController = {
  async verifyToken(req: Request, res: Response, next: NextFunction) {
    try {
      const token = String(req.params.token); // FIX
      if (!token) throw new AppError(400, "token is required", "VALIDATION_ERROR");
      const result = await staffInvitationService.verifyToken(token);
      return sendSuccess(res, 200, result, "Token verified");
    } catch (err) { return next(err); }
  },

  async acceptInvitation(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await staffInvitationService.acceptInvitation(req.body as AcceptInvitationBody);
      return sendSuccess(res, 200, result, "Invitation accepted. You can now log in.");
    } catch (err) { return next(err); }
  },

  async getInvitationStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const staffId = String(req.params.id);
      const result = await staffInvitationService.getInvitationStatus({ staffId, salonId });
      return sendSuccess(res, 200, result, "Invitation status fetched");
    } catch (err) { return next(err); }
  },

  async resendInvitation(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const staffId = String(req.params.id); // FIX
      await staffInvitationService.resendInvitation({
        staffId, salonId, salonName: req.body?.salon_name,
      });
      return sendSuccess(res, 200, null, "Invitation resent");
    } catch (err) { return next(err); }
  },

  async cancelInvitation(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const staffId = String(req.params.id); // FIX
      await staffInvitationService.cancelInvitation({ staffId, salonId });
      return sendSuccess(res, 200, null, "Invitation cancelled");
    } catch (err) { return next(err); }
  },
};

// ─── Addresses ────────────────────────────────────────────────────────────────

export const staffAddressController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffAddressService.list(String(req.params.staffId), getSalonId(req));
      return sendSuccess(res, 200, data, "Addresses fetched successfully");
    } catch (err) { return next(err); }
  },
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffAddressService.create(
        String(req.params.staffId), getSalonId(req), req.body as CreateStaffAddressBody
      );
      return sendSuccess(res, 201, data, "Address created successfully");
    } catch (err) { return next(err); }
  },
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffAddressService.update(
        String(req.params.staffId), getSalonId(req),
        String(req.params.id), req.body as UpdateStaffAddressBody
      );
      return sendSuccess(res, 200, data, "Address updated successfully");
    } catch (err) { return next(err); }
  },
  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await staffAddressService.delete(
        String(req.params.staffId), getSalonId(req), String(req.params.id)
      );
      return sendSuccess(res, 200, null, "Address deleted");
    } catch (err) { return next(err); }
  },
};

// ─── Emergency Contacts ───────────────────────────────────────────────────────

export const staffEmergencyContactController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffEmergencyContactService.list(String(req.params.staffId), getSalonId(req));
      return sendSuccess(res, 200, data, "Emergency contacts fetched successfully");
    } catch (err) { return next(err); }
  },
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffEmergencyContactService.create(
        String(req.params.staffId), getSalonId(req), req.body as CreateEmergencyContactBody
      );
      return sendSuccess(res, 201, data, "Emergency contact created successfully");
    } catch (err) { return next(err); }
  },
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffEmergencyContactService.update(
        String(req.params.staffId), getSalonId(req),
        String(req.params.id), req.body as UpdateEmergencyContactBody
      );
      return sendSuccess(res, 200, data, "Emergency contact updated successfully");
    } catch (err) { return next(err); }
  },
  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await staffEmergencyContactService.delete(
        String(req.params.staffId), getSalonId(req), String(req.params.id)
      );
      return sendSuccess(res, 200, null, "Emergency contact deleted");
    } catch (err) { return next(err); }
  },
};

// ─── Wages ────────────────────────────────────────────────────────────────────

export const staffWagesController = {
  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffWagesService.get(String(req.params.staffId), getSalonId(req));
      return sendSuccess(res, 200, data, "Wage settings fetched successfully");
    } catch (err) { return next(err); }
  },
  async upsert(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffWagesService.upsert(
        String(req.params.staffId), getSalonId(req), req.body as UpdateWageSettingsBody
      );
      return sendSuccess(res, 200, data, "Wage settings updated successfully");
    } catch (err) { return next(err); }
  },
};

// ─── Commissions ──────────────────────────────────────────────────────────────

export const staffCommissionsController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffCommissionsService.list(String(req.params.staffId), getSalonId(req));
      return sendSuccess(res, 200, data, "Commission settings fetched successfully");
    } catch (err) { return next(err); }
  },
  async upsert(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffCommissionsService.upsert(
        String(req.params.staffId), getSalonId(req), req.body as UpdateCommissionBody
      );
      return sendSuccess(res, 200, data, "Commission setting updated successfully");
    } catch (err) { return next(err); }
  },
};

// ─── Pay Runs ─────────────────────────────────────────────────────────────────

export const staffPayRunsController = {
  async get(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffPayRunsService.get(String(req.params.staffId), getSalonId(req));
      return sendSuccess(res, 200, data, "Pay run settings fetched successfully");
    } catch (err) { return next(err); }
  },
  async upsert(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffPayRunsService.upsert(
        String(req.params.staffId), getSalonId(req), req.body as UpdatePayRunBody
      );
      return sendSuccess(res, 200, data, "Pay run settings updated successfully");
    } catch (err) { return next(err); }
  },
};

// ─── Schedules ────────────────────────────────────────────────────────────────

export const staffSchedulesController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffSchedulesService.list(String(req.params.staffId), getSalonId(req));
      return sendSuccess(res, 200, data, "Schedules fetched successfully");
    } catch (err) { return next(err); }
  },
  async upsert(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffSchedulesService.upsert(
        String(req.params.staffId), getSalonId(req), req.body as UpsertStaffSchedulesBody
      );
      return sendSuccess(res, 200, data, "Schedules updated successfully");
    } catch (err) { return next(err); }
  },
};

// ─── Leaves ───────────────────────────────────────────────────────────────────

export const staffLeavesController = {
  async list(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffLeavesService.list(
        String(req.params.staffId), getSalonId(req),
        req.query.from ? String(req.query.from) : undefined,
        req.query.to ? String(req.query.to) : undefined,
      );
      return sendSuccess(res, 200, data, "Leaves fetched successfully");
    } catch (err) { return next(err); }
  },
  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffLeavesService.create(
        String(req.params.staffId), getSalonId(req), req.body as CreateStaffLeaveBody
      );
      return sendSuccess(res, 201, data, "Leave created successfully");
    } catch (err) { return next(err); }
  },
  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await staffLeavesService.update(
        String(req.params.staffId), getSalonId(req),
        String(req.params.id), req.body as UpdateStaffLeaveBody
      );
      return sendSuccess(res, 200, data, "Leave updated successfully");
    } catch (err) { return next(err); }
  },
  async delete(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await staffLeavesService.delete(
        String(req.params.staffId), getSalonId(req), String(req.params.id)
      );
      return sendSuccess(res, 200, null, "Leave deleted");
    } catch (err) { return next(err); }
  },
};