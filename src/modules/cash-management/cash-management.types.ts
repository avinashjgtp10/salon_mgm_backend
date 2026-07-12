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
 
export type CashManagementExpenseRecord = {
  id: string;
  cash_management_id: string;
  salon_id: string;
  expense_type: string;
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
 
export type CreateExpenseBody = {
  cash_management_id: string;
  expense_type: string;
  description?: string;
  amount: number;
  expense_date?: string;
};
 
export type UpdateExpenseBody = Partial<{
  expense_type: string;
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
 
export type ExpenseListFilters = {
  salonId: string;
  cashManagementId?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  page?: number;
  limit?: number;
};

