import { NextFunction, Request, Response } from "express";
import { AppError } from "../../middleware/error.middleware";
import { sendSuccess } from "../utils/response.util";
import { cashManagementService } from "./cash-management.service";
import type {
  CloseCounterBody,
  CreateExpenseBody,
  OpenCounterBody,
  UpdateExpenseBody,
} from "./cash-management.types";

type AuthRequest = Request & {
  user?: {
    userId: string;
    role?: string;
    salonId?: string | null;
  };
};

const getSalonId = (req: AuthRequest): string => {
  const salonId = req.user?.salonId;
  if (!salonId) {
    throw new AppError(403, "Salon context required", "NO_SALON_CONTEXT");
  }
  return salonId;
};

const getUserId = (req: AuthRequest): string => {
  const userId = req.user?.userId;
  if (!userId) {
    throw new AppError(401, "Unauthorized", "UNAUTHORIZED");
  }
  return userId;
};

const parsePage = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const parseOptionalPositiveInt = (value: unknown): number | undefined => {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
};

const parseSortOrder = (value: unknown): "asc" | "desc" =>
  String(value || "").toLowerCase() === "asc" ? "asc" : "desc";

export const cashManagementController = {
  async openCounter(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const userId = getUserId(req);
      const body = req.body as OpenCounterBody;

      const counter = await cashManagementService.openCounter(salonId, userId, {
        opening_balance: Number(body.opening_balance),
      });

      return sendSuccess(res, 201, counter, "Cash counter opened successfully");
    } catch (error) {
      return next(error);
    }
  },

  async getDashboard(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const cashManagementId =
        req.query.cash_management_id !== undefined
          ? String(req.query.cash_management_id || "").trim()
          : undefined;

      const summary = await cashManagementService.getDashboardSummary(
        salonId,
        cashManagementId,
      );

      return sendSuccess(res, 200, summary, "Cash dashboard fetched successfully");
    } catch (error) {
      return next(error);
    }
  },

  async listCounters(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await cashManagementService.listCounters({
        salonId,
        status: req.query.status ? (String(req.query.status).toLowerCase() as "open" | "closed") : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
        sortBy: req.query.sort_by ? String(req.query.sort_by) : undefined,
        sortOrder: parseSortOrder(req.query.sort_order),
        page: parseOptionalPositiveInt(req.query.limit) ? parsePage(req.query.page, 1) : undefined,
        limit: parseOptionalPositiveInt(req.query.limit),
      });

      return sendSuccess(res, 200, data, "Cash counter transactions fetched successfully");
    } catch (error) {
      return next(error);
    }
  },

  async listExpenses(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const data = await cashManagementService.listExpenses({
        salonId,
        cashManagementId: req.query.cash_management_id
          ? String(req.query.cash_management_id)
          : undefined,
        search: req.query.search ? String(req.query.search) : undefined,
        sortBy: req.query.sort_by ? String(req.query.sort_by) : undefined,
        sortOrder: parseSortOrder(req.query.sort_order),
        page: parseOptionalPositiveInt(req.query.limit) ? parsePage(req.query.page, 1) : undefined,
        limit: parseOptionalPositiveInt(req.query.limit),
      });

      return sendSuccess(res, 200, data, "Cash expenses fetched successfully");
    } catch (error) {
      return next(error);
    }
  },

  async createExpense(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const userId = getUserId(req);
      const body = req.body as CreateExpenseBody;

      const result = await cashManagementService.createExpense(salonId, userId, {
        cash_management_id: String(body.cash_management_id || "").trim(),
        expense_type: String(body.expense_type || "").trim(),
        description: body.description ? String(body.description) : undefined,
        amount: Number(body.amount),
        expense_date: body.expense_date ? String(body.expense_date) : undefined,
      });

      return sendSuccess(res, 201, result, "Cash expense added successfully");
    } catch (error) {
      return next(error);
    }
  },

  async updateExpense(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const body = req.body as UpdateExpenseBody;

      const result = await cashManagementService.updateExpense(salonId, String(req.params.id || ""), {
        expense_type: body.expense_type !== undefined ? String(body.expense_type) : undefined,
        description: body.description !== undefined ? String(body.description) : undefined,
        amount: body.amount !== undefined ? Number(body.amount) : undefined,
        expense_date: body.expense_date !== undefined ? String(body.expense_date) : undefined,
      });

      return sendSuccess(res, 200, result, "Cash expense updated successfully");
    } catch (error) {
      return next(error);
    }
  },

  async deleteExpense(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const result = await cashManagementService.deleteExpense(salonId, String(req.params.id || ""));
      return sendSuccess(res, 200, result, "Cash expense deleted successfully");
    } catch (error) {
      return next(error);
    }
  },

  async closeCounter(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = getSalonId(req);
      const userId = getUserId(req);
      const body = req.body as CloseCounterBody;
      const cashManagementId =
        body.cash_management_id !== undefined && body.cash_management_id !== null
          ? String(body.cash_management_id || "").trim()
          : String(req.query.cash_management_id || "").trim();
      const inStoreCashRaw =
        body.in_store_cash !== undefined && body.in_store_cash !== null
          ? body.in_store_cash
          : req.query.in_store_cash;
      const remarks =
        body.remarks !== undefined && body.remarks !== null
          ? String(body.remarks)
          : req.query.remarks !== undefined && req.query.remarks !== null
            ? String(req.query.remarks)
            : undefined;

      const result = await cashManagementService.closeCounter(salonId, userId, {
        cash_management_id: cashManagementId,
        in_store_cash: Number(inStoreCashRaw),
        remarks,
      });

      return sendSuccess(res, 200, result, "Cash counter closed successfully");
    } catch (error) {
      return next(error);
    }
  },
};
