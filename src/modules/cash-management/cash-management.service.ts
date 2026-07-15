import { AppError } from "../../middleware/error.middleware";
import { cashManagementRepository } from "./cash-management.repository";
import type {
  CloseCounterBody,
  CounterListFilters,
  CreateExpenseBody,
  ExpenseListFilters,
  OpenCounterBody,
  UpdateExpenseBody,
} from "./cash-management.types";

export const cashManagementService = {
  async openCounter(salonId: string, createdBy: string, body: OpenCounterBody) {
    if (!Number.isFinite(body.opening_balance) || body.opening_balance < 0) {
      throw new AppError(400, "opening_balance must be a non-negative number", "VALIDATION_ERROR");
    }

    return cashManagementRepository.openCounter({
      salonId,
      openingBalance: body.opening_balance,
      createdBy,
    });
  },

  async getDashboardSummary(salonId: string, cashManagementId?: string) {
    return cashManagementRepository.getDashboardSummary(
      salonId,
      cashManagementId?.trim(),
    );
  },

  async listCounters(filters: CounterListFilters) {
    if (filters.status && !["open", "closed"].includes(filters.status)) {
      throw new AppError(400, "status must be open or closed", "VALIDATION_ERROR");
    }
    return cashManagementRepository.listCounters(filters);
  },

  async listExpenses(filters: ExpenseListFilters) {
    return cashManagementRepository.listExpenses(filters);
  },

  async createExpense(salonId: string, createdBy: string, body: CreateExpenseBody) {
    if (!body.cash_management_id?.trim()) {
      throw new AppError(400, "cash_management_id is required", "VALIDATION_ERROR");
    }
    if (!body.expense_type?.trim()) {
      throw new AppError(400, "expense_type is required", "VALIDATION_ERROR");
    }
    if (!Number.isFinite(body.amount) || body.amount < 0) {
      throw new AppError(400, "amount must be a non-negative number", "VALIDATION_ERROR");
    }

    return cashManagementRepository.createExpense({
      salonId,
      createdBy,
      body,
    });
  },

  async updateExpense(salonId: string, expenseId: string, body: UpdateExpenseBody) {
    if (!expenseId.trim()) {
      throw new AppError(400, "expense id is required", "VALIDATION_ERROR");
    }
    if (body.amount !== undefined && (!Number.isFinite(body.amount) || body.amount < 0)) {
      throw new AppError(400, "amount must be a non-negative number", "VALIDATION_ERROR");
    }
    if (body.expense_type !== undefined && !body.expense_type.trim()) {
      throw new AppError(400, "expense_type cannot be empty", "VALIDATION_ERROR");
    }

    return cashManagementRepository.updateExpense({
      salonId,
      expenseId: expenseId.trim(),
      body,
    });
  },

  async deleteExpense(salonId: string, expenseId: string) {
    if (!expenseId.trim()) {
      throw new AppError(400, "expense id is required", "VALIDATION_ERROR");
    }
    return cashManagementRepository.deleteExpense({
      salonId,
      expenseId: expenseId.trim(),
    });
  },

  async closeCounter(salonId: string, closedBy: string, body: CloseCounterBody) {
    if (!body.cash_management_id?.trim()) {
      throw new AppError(400, "cash_management_id is required", "VALIDATION_ERROR");
    }
    if (!Number.isFinite(body.in_store_cash) || body.in_store_cash < 0) {
      throw new AppError(400, "in_store_cash must be a non-negative number", "VALIDATION_ERROR");
    }

    return cashManagementRepository.closeCounter({
      salonId,
      cashManagementId: body.cash_management_id.trim(),
      inStoreCash: body.in_store_cash,
      remarks: body.remarks,
      closedBy,
    });
  },
};
