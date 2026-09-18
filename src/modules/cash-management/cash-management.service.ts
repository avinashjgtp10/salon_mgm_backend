import { AppError } from "../../middleware/error.middleware";
import { cashManagementRepository } from "./cash-management.repository";
import { salonDashboardService } from "../salon-dashboard/salon-dashboard.service";
import type {
  CloseCounterBody,
  CounterListFilters,
  CreateExpenseBody,
  ExpenseListFilters,
  OpenCounterBody,
  SummaryBundleBody,
  SummaryBundleSection,
  UpdateExpenseBody,
} from "./cash-management.types";

const SUMMARY_BUNDLE_SECTIONS: SummaryBundleSection[] = [
  "cash_dashboard",
  "cash_counters",
  "cash_expenses",
  "dashboard_summary",
];

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

  async listCashIncomeEntries(salonId: string, cashManagementId: string) {
    if (!cashManagementId?.trim()) {
      throw new AppError(400, "cash_management_id is required", "VALIDATION_ERROR");
    }
    return cashManagementRepository.listCashIncomeEntries({
      salonId,
      cashManagementId: cashManagementId.trim(),
    });
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

  // Fetches only the sections the caller asked for, in parallel, so a page
  // that needs several of the cash-management/dashboard widgets at once can
  // do it in one round trip instead of four.
  async getSummaryBundle(salonId: string, body: SummaryBundleBody) {
    const sections = Array.isArray(body.sections) ? body.sections : [];
    if (!sections.length) {
      throw new AppError(400, "sections must be a non-empty array", "VALIDATION_ERROR");
    }
    const invalid = sections.filter((s) => !SUMMARY_BUNDLE_SECTIONS.includes(s));
    if (invalid.length) {
      throw new AppError(400, `Invalid section(s): ${invalid.join(", ")}`, "VALIDATION_ERROR");
    }

    const tasks: Partial<Record<SummaryBundleSection, Promise<unknown>>> = {};

    if (sections.includes("cash_dashboard")) {
      tasks.cash_dashboard = this.getDashboardSummary(salonId, body.cash_management_id);
    }
    if (sections.includes("cash_counters")) {
      tasks.cash_counters = this.listCounters({
        salonId,
        status: body.counters?.status,
        search: body.counters?.search,
        from: body.counters?.from,
        to: body.counters?.to,
        sortBy: body.counters?.sort_by,
        sortOrder: body.counters?.sort_order === "asc" ? "asc" : "desc",
        page: body.counters?.page,
        limit: body.counters?.limit,
      });
    }
    if (sections.includes("cash_expenses")) {
      tasks.cash_expenses = this.listExpenses({
        salonId,
        cashManagementId: body.expenses?.cash_management_id ?? body.cash_management_id,
        search: body.expenses?.search,
        sortBy: body.expenses?.sort_by,
        sortOrder: body.expenses?.sort_order === "asc" ? "asc" : "desc",
        page: body.expenses?.page,
        limit: body.expenses?.limit,
      });
    }
    if (sections.includes("dashboard_summary")) {
      tasks.dashboard_summary = salonDashboardService.getSummary(salonId);
    }

    const keys = Object.keys(tasks) as SummaryBundleSection[];
    const values = await Promise.all(keys.map((key) => tasks[key]));
    const result: Partial<Record<SummaryBundleSection, unknown>> = {};
    keys.forEach((key, i) => { result[key] = values[i]; });
    return result;
  },
};
