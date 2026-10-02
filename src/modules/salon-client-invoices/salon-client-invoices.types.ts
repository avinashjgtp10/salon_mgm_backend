export type InvoicePaymentStatus = "paid" | "pending" | "failed";

export interface InvoiceLineItemRow {
  description: string;
  sac_code: string | null;
  qty: number;
  rate: number;
  amount: number;
}

export interface SalonClientInvoiceRow {
  id: string;
  salon_id: string;
  invoice_no: string;
  financial_year: string;
  invoice_date: string;
  branch: string | null;
  customer_name: string;
  customer_address: string | null;
  customer_contact: string | null;
  customer_email: string | null;
  staff_name: string | null;
  payment_mode: string | null;
  status: InvoicePaymentStatus;
  subtotal: number;
  gst_amount: number;
  total_amount: number;
  created_at: string;
  updated_at: string;
}

export interface SalonClientInvoiceWithItems extends SalonClientInvoiceRow {
  items: InvoiceLineItemRow[];
}

export interface InvoiceListFilters {
  branch?: string;
  status?: InvoicePaymentStatus;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  perPage?: number;
}

export interface InvoiceListSummary {
  total_invoices: number;
  paid_count: number;
  pending_count: number;
  failed_count: number;
  revenue: number;
  tax_collected: number;
}

export interface CreateInvoiceLineItemInput {
  description: string;
  sac_code?: string;
  qty: number;
  rate: number;
}

export interface CreateInvoiceInput {
  branch?: string;
  invoice_date: string;
  customer_name: string;
  customer_address?: string;
  customer_contact?: string;
  customer_email?: string;
  staff_name?: string;
  payment_mode?: string;
  status: InvoicePaymentStatus;
  line_items: CreateInvoiceLineItemInput[];
}
