import { Request, Response, NextFunction } from "express";
import { salonPlansService } from "./salon-plans.service";

type AuthedRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const salonPlansController = {
    // ── Plan Definitions ─────────────────────────────────────────────────────

    async listPlanDefinitions(_req: Request, res: Response, next: NextFunction) {
        try {
            const data = await salonPlansService.listPlanDefinitions();
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    async updatePlanDefinition(req: AuthedRequest, res: Response, next: NextFunction) {
        try {
            const updatedBy = req.user?.userId ?? "";
            const data = await salonPlansService.updatePlanDefinition(String(req.params.tier), req.body, updatedBy);
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    async syncToRazorpay(req: AuthedRequest, res: Response, next: NextFunction) {
        try {
            const updatedBy = req.user?.userId ?? "";
            const data = await salonPlansService.syncToRazorpay(String(req.params.tier), updatedBy);
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    // ── Salon Customizations ─────────────────────────────────────────────────

    async searchCustomizations(req: Request, res: Response, next: NextFunction) {
        try {
            const query = typeof req.query.search === "string" ? req.query.search : undefined;
            const data = await salonPlansService.searchCustomizations(query);
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    async getCustomization(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await salonPlansService.getCustomization(String(req.params.salonId));
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    async upsertCustomization(req: AuthedRequest, res: Response, next: NextFunction) {
        try {
            const updatedBy = req.user?.userId ?? "";
            const data = await salonPlansService.upsertCustomization(String(req.params.salonId), req.body, updatedBy);
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    async removeCustomization(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await salonPlansService.removeCustomization(String(req.params.salonId));
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    // ── My Features / My Plan (salon-facing) ─────────────────────────────────

    async getMyFeatures(req: AuthedRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) return res.status(403).json({ success: false, error: { message: "No salon context" } });
            const data = await salonPlansService.getMyFeatures(salonId);
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    async getMyPlan(req: AuthedRequest, res: Response, next: NextFunction) {
        try {
            const salonId = req.user?.salonId;
            if (!salonId) return res.status(403).json({ success: false, error: { message: "No salon context" } });
            const data = await salonPlansService.getMyPlan(salonId);
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    // ── Invoices ──────────────────────────────────────────────────────────────

    async listInvoices(req: Request, res: Response, next: NextFunction) {
        try {
            const { salon_id, status, search, page, limit } = req.query;
            const data = await salonPlansService.listInvoices({
                salon_id: typeof salon_id === "string" ? salon_id : undefined,
                status: typeof status === "string" ? (status as any) : undefined,
                search: typeof search === "string" ? search : undefined,
                page: page ? parseInt(page as string, 10) : undefined,
                limit: limit ? parseInt(limit as string, 10) : undefined,
            });
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    async createInvoice(req: AuthedRequest, res: Response, next: NextFunction) {
        try {
            const createdBy = req.user?.userId ?? "";
            const data = await salonPlansService.createInvoice(req.body, createdBy);
            return res.status(201).json({ success: true, data });
        } catch (err) { return next(err); }
    },

    async updateInvoiceStatus(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await salonPlansService.updateInvoiceStatus(String(req.params.id), req.body.status);
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    async deleteInvoice(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await salonPlansService.deleteInvoice(String(req.params.id));
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    // ── Billing & Invoices page (filtered list/summary/branches/print) ─────────

    _parseListFilters(query: Request["query"] | Record<string, unknown>) {
        const { salon_id, status, branch, search, date_from, date_to, page, limit } = query;
        return {
            salon_id: typeof salon_id === "string" ? salon_id : undefined,
            status: typeof status === "string" ? (status as any) : undefined,
            branch: typeof branch === "string" ? branch : undefined,
            search: typeof search === "string" ? search : undefined,
            date_from: typeof date_from === "string" ? date_from : undefined,
            date_to: typeof date_to === "string" ? date_to : undefined,
            page: page ? parseInt(String(page), 10) : undefined,
            limit: limit ? parseInt(String(limit), 10) : undefined,
        };
    },

    async listInvoicesFiltered(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await salonPlansService.listInvoicesFiltered(salonPlansController._parseListFilters(req.query));
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    async invoicesSummary(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await salonPlansService.invoicesSummary(salonPlansController._parseListFilters(req.query));
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    // POST /invoices/overview — same filters as the GET list/summary, sent in the body.
    async invoicesOverview(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await salonPlansService.invoicesOverview(salonPlansController._parseListFilters(req.body ?? {}));
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    async invoiceBranches(_req: Request, res: Response, next: NextFunction) {
        try {
            const data = await salonPlansService.invoiceBranches();
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },

    async getInvoiceForPrint(req: Request, res: Response, next: NextFunction) {
        try {
            const data = await salonPlansService.getInvoiceForPrint(String(req.params.id));
            return res.json({ success: true, data });
        } catch (err) { return next(err); }
    },
};
