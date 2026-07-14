import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { commissionRulesService } from "./commissionRules.service";
import {
    CreateCommissionRuleBody,
    UpdateCommissionRuleBody,
    CommissionRuleListQuery,
} from "./commissionRules.types";

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string } };

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
};

export const commissionRulesController = {
    async list(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const query: CommissionRuleListQuery = {
                source: req.query.source as any,
                status: req.query.status as any,
                scope_type: req.query.scope_type as any,
                scope_id: req.query.scope_id ? String(req.query.scope_id) : undefined,
            };
            const rules = await commissionRulesService.list(salonId, query);
            return sendSuccess(res, 200, { items: rules }, "Commission rules fetched successfully");
        } catch (err) { return next(err); }
    },

    async getById(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const rule = await commissionRulesService.getById(String(req.params.id), salonId);
            return sendSuccess(res, 200, rule, "Commission rule fetched successfully");
        } catch (err) { return next(err); }
    },

    async create(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const rules = await commissionRulesService.create(salonId, req.body as CreateCommissionRuleBody);
            const message = rules.length > 1
                ? `Commission rule created for ${rules.length} staff members`
                : "Commission rule created successfully";
            return sendSuccess(res, 201, { items: rules }, message);
        } catch (err) { return next(err); }
    },

    async update(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const rule = await commissionRulesService.update(String(req.params.id), salonId, req.body as UpdateCommissionRuleBody);
            return sendSuccess(res, 200, rule, "Commission rule updated successfully");
        } catch (err) { return next(err); }
    },

    async updateStatus(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            const rule = await commissionRulesService.updateStatus(String(req.params.id), salonId, req.body.status);
            return sendSuccess(res, 200, rule, "Commission rule status updated successfully");
        } catch (err) { return next(err); }
    },

    async delete(req: AuthRequest, res: Response, next: NextFunction) {
        try {
            const salonId = getSalonId(req);
            await commissionRulesService.delete(String(req.params.id), salonId);
            return sendSuccess(res, 200, null, "Commission rule deleted successfully");
        } catch (err) { return next(err); }
    },
};
