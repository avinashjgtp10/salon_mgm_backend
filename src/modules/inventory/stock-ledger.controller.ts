import { Request, Response, NextFunction } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { stockLedgerService } from "./stock-ledger.service";
import {
    CreateStockLedgerEntryBody,
    UpdateStockLedgerEntryBody,
    ListStockLedgerFilters,
    StockLedgerTransactionType,
} from "./stock-ledger.types";

type AuthRequest = Request & {
    user?: { userId: string; role?: string; salonId?: string };
};

const getSalonId = (req: AuthRequest): string => {
    const salonId = req.user?.salonId;
    if (!salonId) throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
    return salonId;
};

export const stockLedgerController = {
    async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            const role = req.user?.role;
            const salonId = getSalonId(req);
            if (!userId) throw new AppError(401, "Unauthorized", "UNAUTHORIZED");

            const entry = await stockLedgerService.create({
                requesterUserId: userId,
                requesterRole: role,
                salonId,
                body: req.body as CreateStockLedgerEntryBody,
            });
            sendSuccess(res, 201, entry, "Stock ledger entry created successfully");
        } catch (err) { next(err); }
    },

    async list(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const q = req.query;
            const filters: ListStockLedgerFilters = {
                branch_id: q.branch_id as string | undefined,
                product_id: q.product_id as string | undefined,
                category_id: q.category_id as string | undefined,
                transaction_type: q.transaction_type as StockLedgerTransactionType | undefined,
                staff_id: q.staff_id as string | undefined,
                search: q.search as string | undefined,
                from_date: q.from_date as string | undefined,
                to_date: q.to_date as string | undefined,
                page: q.page ? parseInt(q.page as string, 10) : undefined,
                limit: q.limit ? parseInt(q.limit as string, 10) : undefined,
            };
            const result = await stockLedgerService.list(filters, salonId);
            sendSuccess(res, 200, result, "Stock ledger fetched successfully");
        } catch (err) { next(err); }
    },

    // POST /inventory/stock-ledger/list — same filters as GET /stock-ledger,
    // read from the JSON body instead of query params (report-style: one
    // call carries search + every dropdown filter + pagination together).
    async search(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const b = req.body ?? {};
            const filters: ListStockLedgerFilters = {
                branch_id: b.branch_id as string | undefined,
                product_id: b.product_id as string | undefined,
                category_id: b.category_id as string | undefined,
                transaction_type: b.transaction_type as StockLedgerTransactionType | undefined,
                staff_id: b.staff_id as string | undefined,
                search: b.search as string | undefined,
                from_date: b.from_date as string | undefined,
                to_date: b.to_date as string | undefined,
                page: b.page !== undefined ? Number(b.page) : undefined,
                limit: b.limit !== undefined ? Number(b.limit) : undefined,
            };
            const result = await stockLedgerService.list(filters, salonId);
            sendSuccess(res, 200, result, "Stock ledger fetched successfully");
        } catch (err) { next(err); }
    },

    async getById(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const entry = await stockLedgerService.getById(String(req.params.id), salonId);
            sendSuccess(res, 200, entry, "Stock ledger entry fetched successfully");
        } catch (err) { next(err); }
    },

    async getTimelineForProduct(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const timeline = await stockLedgerService.getTimelineForProduct(String(req.params.productId), salonId);
            sendSuccess(res, 200, timeline, "Stock movement timeline fetched successfully");
        } catch (err) { next(err); }
    },

    async update(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            const updated = await stockLedgerService.update(String(req.params.id), req.body as UpdateStockLedgerEntryBody, salonId);
            sendSuccess(res, 200, updated, "Stock ledger entry updated successfully");
        } catch (err) { next(err); }
    },

    async delete(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const salonId = getSalonId(req);
            await stockLedgerService.delete(String(req.params.id), salonId);
            sendSuccess(res, 200, null, "Stock ledger entry deleted successfully");
        } catch (err) { next(err); }
    },
};
