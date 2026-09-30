import pool from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import { salonClientInvoicesRepository } from "./salon-client-invoices.repository";
import { amountInWords } from "./amount-in-words.util";
import type { CreateInvoiceInput, InvoiceListFilters } from "./salon-client-invoices.types";

export interface SellerBankDetails {
  salon_name: string;
  address: string | null;
  contact: string | null;
  email: string | null;
  gst_number: string | null;
  pan: string | null;
  bank_name: string | null;
  bank_account_holder: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  bank_branch: string | null;
  bank_account_type: string | null;
}

async function getSellerDetails(salonId: string): Promise<SellerBankDetails> {
  const { rows } = await pool.query(
    `SELECT business_name AS salon_name, address, address_line2, phone AS contact, email,
            gst_number, pan_number AS pan,
            bank_name, bank_account_holder, bank_account_number, bank_ifsc, bank_branch, bank_account_type
     FROM salons WHERE id = $1`,
    [salonId]
  );
  if (rows.length === 0) throw new AppError(404, "Salon not found", "SALON_NOT_FOUND");
  const r = rows[0];
  return {
    salon_name: r.salon_name,
    address: [r.address, r.address_line2].filter(Boolean).join(", ") || null,
    contact: r.contact,
    email: r.email,
    gst_number: r.gst_number,
    pan: r.pan,
    bank_name: r.bank_name,
    bank_account_holder: r.bank_account_holder,
    bank_account_number: r.bank_account_number,
    bank_ifsc: r.bank_ifsc,
    bank_branch: r.bank_branch,
    bank_account_type: r.bank_account_type,
  };
}

function parseFilters(query: Record<string, any>): InvoiceListFilters {
  return {
    branch: typeof query.branch === "string" && query.branch ? query.branch : undefined,
    status: typeof query.status === "string" && query.status ? (query.status as any) : undefined,
    search: typeof query.search === "string" && query.search ? query.search : undefined,
    dateFrom: typeof query.date_from === "string" && query.date_from ? query.date_from : undefined,
    dateTo: typeof query.date_to === "string" && query.date_to ? query.date_to : undefined,
    page: query.page ? Number(query.page) : undefined,
    perPage: query.per_page ? Number(query.per_page) : undefined,
  };
}

export const salonClientInvoicesService = {
  parseFilters,

  async list(salonId: string, filters: InvoiceListFilters) {
    const { rows, total } = await salonClientInvoicesRepository.list(salonId, filters);
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const perPage = filters.perPage && filters.perPage > 0 ? filters.perPage : 10;
    return { data: rows, total, page, per_page: perPage };
  },

  async summary(salonId: string, filters: InvoiceListFilters) {
    return salonClientInvoicesRepository.summary(salonId, filters);
  },

  async branches(salonId: string) {
    return salonClientInvoicesRepository.listDistinctBranches(salonId);
  },

  async searchClients(salonId: string, q: string) {
    if (!q?.trim()) return [];
    return salonClientInvoicesRepository.searchClients(salonId, q, 20);
  },

  async getForPrint(salonId: string, invoiceId: string) {
    const invoice = await salonClientInvoicesRepository.findByIdWithItems(salonId, invoiceId);
    if (!invoice) throw new AppError(404, "Invoice not found", "INVOICE_NOT_FOUND");
    const seller = await getSellerDetails(salonId);
    return {
      invoice,
      seller,
      amount_in_words: amountInWords(invoice.total_amount),
    };
  },

  async create(salonId: string, input: CreateInvoiceInput, createdByUserId: string | null) {
    if (!input.customer_name?.trim()) {
      throw new AppError(400, "Customer name is required", "VALIDATION_ERROR");
    }
    if (!input.line_items?.length) {
      throw new AppError(400, "At least one line item is required", "VALIDATION_ERROR");
    }
    for (const li of input.line_items) {
      if (!li.description?.trim() || li.qty <= 0 || li.rate <= 0) {
        throw new AppError(400, "Each line item needs a description, quantity and rate greater than 0", "VALIDATION_ERROR");
      }
    }
    if (!["paid", "pending", "failed"].includes(input.status)) {
      throw new AppError(400, "Invalid payment status", "VALIDATION_ERROR");
    }

    return salonClientInvoicesRepository.create(salonId, input, createdByUserId);
  },
};
