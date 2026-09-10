import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { rolesService } from "./roles.service";
import {
    CreateRoleBody,
    UpdateRoleBody,
    SetStaffOverridesBody,
    AssignStaffRoleBody,
    BulkAssignRoleBody,
    BulkResetOverridesBody,
} from "./roles.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
};

const getActor = (req: AuthRequest) => {
    const userId = req.user?.userId;
    if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
    return {
        userId,
        role: req.user?.role,
        salonId: req.user?.salonId,
        ipAddress: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
    };
};

export const permissionsController = {
    async list(_req: Request, res: Response, next: NextFunction) {
        try {
            const permissions = await rolesService.listPermissions();
            return sendSuccess(res, 200, { items: permissions }, "Permissions fetched successfully");
        } catch (err) { return next(err); }
    },
};

export const auditLogController = {
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const targetStaffId = req.query.target_staff_id ? String(req.query.target_staff_id) : undefined;
            const limit = req.query.limit ? Number(req.query.limit) : undefined;
            const cursor = req.query.cursor ? String(req.query.cursor) : undefined;
            const result = await rolesService.listAuditLog(salonId, { targetStaffId, limit, cursor });
            return sendSuccess(res, 200, result, "Permission audit log fetched successfully");
        } catch (err) { return next(err); }
    },
};

export const rolesController = {
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const roles = await rolesService.listRoles(salonId);
            return sendSuccess(res, 200, { items: roles }, "Roles fetched successfully");
        } catch (err) { return next(err); }
    },

    async getById(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const role = await rolesService.getRoleWithPermissions(String(req.params.id), salonId);
            return sendSuccess(res, 200, role, "Role fetched successfully");
        } catch (err) { return next(err); }
    },

    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const actor = getActor(req);
            const role = await rolesService.createRole(salonId, actor, req.body as CreateRoleBody);
            return sendSuccess(res, 201, role, "Role created successfully");
        } catch (err) { return next(err); }
    },

    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const actor = getActor(req);
            const role = await rolesService.updateRole(String(req.params.id), salonId, actor, req.body as UpdateRoleBody);
            return sendSuccess(res, 200, role, "Role updated successfully");
        } catch (err) { return next(err); }
    },

    async remove(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const reassignTo = req.query.reassign_to ? String(req.query.reassign_to) : undefined;
            await rolesService.deleteRole(String(req.params.id), salonId, reassignTo);
            return sendSuccess(res, 200, null, "Role deleted successfully");
        } catch (err) { return next(err); }
    },

    async duplicate(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const actor = getActor(req);
            const role = await rolesService.duplicateRole(String(req.params.id), salonId, actor);
            return sendSuccess(res, 201, role, "Role duplicated successfully");
        } catch (err) { return next(err); }
    },
};

export const staffPermissionsController = {
    async getEffective(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const view = await rolesService.getStaffEffectivePermissions(String(req.params.id), salonId);
            return sendSuccess(res, 200, view, "Staff permissions fetched successfully");
        } catch (err) { return next(err); }
    },

    async setOverrides(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const actor = getActor(req);
            const body = req.body as SetStaffOverridesBody;
            if (!body.overrides || typeof body.overrides !== "object") {
                throw new AppError(400, "overrides is required and must be an object", "VALIDATION_ERROR");
            }
            const view = await rolesService.setStaffOverrides(String(req.params.id), salonId, actor, body.overrides);
            return sendSuccess(res, 200, view, "Staff permission overrides updated successfully");
        } catch (err) { return next(err); }
    },

    async assignRole(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const actor = getActor(req);
            const body = req.body as AssignStaffRoleBody;
            if (!body.role_id) throw new AppError(400, "role_id is required", "VALIDATION_ERROR");
            const view = await rolesService.assignStaffRole(String(req.params.id), salonId, actor, body.role_id);
            return sendSuccess(res, 200, view, "Staff role assigned successfully");
        } catch (err) { return next(err); }
    },

    async bulkAssignRole(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const actor = getActor(req);
            const body = req.body as BulkAssignRoleBody;
            if (!Array.isArray(body.staffIds) || body.staffIds.length === 0) {
                throw new AppError(400, "staffIds is required and must be a non-empty array", "VALIDATION_ERROR");
            }
            if (!body.roleId) throw new AppError(400, "roleId is required", "VALIDATION_ERROR");
            await rolesService.bulkAssignRole(body.staffIds, salonId, actor, body.roleId);
            return sendSuccess(res, 200, null, `Role assigned to ${body.staffIds.length} staff member(s)`);
        } catch (err) { return next(err); }
    },

    async bulkResetOverrides(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const actor = getActor(req);
            const body = req.body as BulkResetOverridesBody;
            if (!Array.isArray(body.staffIds) || body.staffIds.length === 0) {
                throw new AppError(400, "staffIds is required and must be a non-empty array", "VALIDATION_ERROR");
            }
            await rolesService.bulkResetOverrides(body.staffIds, salonId, actor);
            return sendSuccess(res, 200, null, `Overrides reset for ${body.staffIds.length} staff member(s)`);
        } catch (err) { return next(err); }
    },
};
