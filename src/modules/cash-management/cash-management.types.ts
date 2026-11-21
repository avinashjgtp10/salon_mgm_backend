export type CashManagementStatus = "open" | "closed";
 
export type CashManagementRecord = {
  id: string;
  salon_id: string;
  status: CashManagementStatus;
  opening_balance: string;
  cash_revenue: string;
  cash_expense: string;
  closing_balance: string;
  in_store_cash: string | null;
  reconciliation_amount: string | null;
  remarks: string | null;
  opened_at: string;
  closed_at: string | null;
  created_by: string | null;
  closed_by: string | null;
  created_at: string;
  updated_at: string;
};
 
/** How an expense was paid. Only "cash" expenses come out of the cash counter; the rest are recorded but do not change the cash balance. */
export const EXPENSE_PAYMENT_METHODS = ["cash", "upi", "card", "bank_transfer", "other"] as const;
export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];

export type CashManagementExpenseRecord = {
  id: string;
  cash_management_id: string | null;
  salon_id: string;
  expense_type: string;
  payment_method: string;
  /** "paid" counts as cash outflow; "unpaid" is recorded but excluded from every outflow figure. */
  status?: string;
  description: string | null;
  amount: string;
  expense_date: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  transaction_status?: CashManagementStatus;
  transaction_opened_at?: string;
  transaction_closed_at?: string | null;
};
 
export type OpenCounterBody = {
  opening_balance: number;
};
 
export type CloseCounterBody = {
  cash_management_id: string;
  in_store_cash: number;
  remarks?: string;
};
 
// Edit of an already opened or closed counter. Open counters take opening_balance only; closed counters also take
// in_store_cash and remarks. Every field is optional — only what is sent is changed.
export type EditCounterBody = {
  opening_balance?: number;
  /** Independent of opening_balance: editing one never recalculates the other. */
  closing_balance?: number;
  in_store_cash?: number;
  remarks?: string | null;
};

export type CreateExpenseBody = {
  /** Ignored: expenses are independent of the cash counter (kept optional so older clients still work). */
  cash_management_id?: string;
  expense_type: string;
  /** Defaults to "cash" when omitted (older clients). */
  payment_method?: string;
  /** "paid" (default) | "unpaid". */
  status?: string;
  description?: string;
  amount: number;
  expense_date?: string;
};
 
export type UpdateExpenseBody = Partial<{
  expense_type: string;
  payment_method: string;
  status: string;
  description: string;
  amount: number;
  expense_date: string;
}>;
 
export type CounterListFilters = {
  salonId: string;
  status?: CashManagementStatus;
  search?: string;
  from?: string;
  to?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
};
 
export const EXPENSE_STATUSES = ["paid", "unpaid"] as const;

export type ExpenseOverviewFilters = { salonId: string; from?: string; to?: string };

export type ExpenseOverview = {
  /** Revenue received in the range: the Sales Summary report's "Received Amount" (same figure as the dashboard). */
  total_revenue: number;
  /** PAID expenses only: the real cash outflow. */
  total_expenses: number;
  /** Unpaid expenses: shown separately, never part of outflow or net cash flow. */
  unpaid_expenses: number;
  paid_count: number;
  unpaid_count: number;
  /** total_revenue - total_expenses */
  net_cash_flow: number;
  daily: { date: string; revenue: number; expenses: number }[];
  categories: { name: string; amount: number; count: number }[];
};

export type ExpenseListFilters = {
  salonId: string;
  cashManagementId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
};

// Sections the caller can request from POST /cash-management/summary-bundle —
// one request in place of separately hitting GET /cashdashboard, GET /
// (counters), GET /expenses and GET /dashboard/summary.
export type SummaryBundleSection = "cash_dashboard" | "cash_counters" | "cash_expenses" | "dashboard_summary";

export type SummaryBundleBody = {
  sections: SummaryBundleSection[];
  // Shared default for cash_dashboard + cash_expenses; expenses.cash_management_id overrides it.
  cash_management_id?: string;
  counters?: {
    status?: CashManagementStatus;
    search?: string;
    from?: string;
    to?: string;
    sort_by?: string;
    sort_order?: "asc" | "desc";
    page?: number;
    limit?: number;
  };
  expenses?: {
    cash_management_id?: string;
    search?: string;
    sort_by?: string;
    sort_order?: "asc" | "desc";
    page?: number;
    limit?: number;
  };
};

