import pool from "../../config/database";
import { financialYearFor } from "./financial-year.util";
import type {
  CreateInvoiceInput,
  InvoiceListFilters,
  InvoiceListSummary,
  SalonClientInvoiceRow,
  SalonClientInvoiceWithItems,
} from "./salon-client-invoices.types";

function buildWhere(salonId: string, filters: InvoiceListFilters): { clause: string; params: any[] } {
  const params: any[] = [salonId];
  const conditions = ["salon_id = $1"];

  if (filters.branch) {
    params.push(filters.branch);
    conditions.push(`branch = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    conditions.push(`invoice_date >= $${params.length}`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    conditions.push(`invoice_date <= $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search.toLowerCase()}%`);
    conditions.push(`(LOWER(invoice_no) LIKE $${params.length} OR LOWER(customer_name) LIKE $${params.length})`);
  }

  return { clause: conditions.join(" AND "), params };
}

export const salonClientInvoicesRepository = {
  async list(salonId: string, filters: InvoiceListFilters): Promise<{ rows: SalonClientInvoiceRow[]; total: number }> {
    const { clause, params } = buildWhere(salonId, filters);
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const perPage = filters.perPage && filters.perPage > 0 ? filters.perPage : 10;
    const offset = (page - 1) * perPage;

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM salon_client_invoices WHERE ${clause}`,
      params
    );

    const dataParams = [...params, perPage, offset];
    const { rows } = await pool.query(
      `SELECT * FROM salon_client_invoices
       WHERE ${clause}
       ORDER BY invoice_date DESC, created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      dataParams
    );

    return { rows, total: countRows[0]?.count ?? 0 };
  },

  async summary(salonId: string, filters: InvoiceListFilters): Promise<InvoiceListSummary> {
    const { clause, params } = buildWhere(salonId, filters);
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)::int AS total_invoices,
         COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count,
         COALESCE(SUM(total_amount), 0)::numeric AS revenue,
         COALESCE(SUM(gst_amount), 0)::numeric AS tax_collected
       FROM salon_client_invoices
       WHERE ${clause}`,
      params
    );
    return rows[0];
  },

  async findByIdWithItems(salonId: string, invoiceId: string): Promise<SalonClientInvoiceWithItems | null> {
    const { rows: invRows } = await pool.query(
      `SELECT * FROM salon_client_invoices WHERE id = $1 AND salon_id = $2`,
      [invoiceId, salonId]
    );
    if (invRows.length === 0) return null;

    const { rows: itemRows } = await pool.query(
      `SELECT description, sac_code, qty, rate, amount
       FROM salon_client_invoice_items
       WHERE invoice_id = $1
       ORDER BY created_at ASC`,
      [invoiceId]
    );

    return { ...invRows[0], items: itemRows };
  },

  // Per-salon, per-financial-year sequential counter — mirrors the
  // UPDATE...RETURNING pattern sales.repository.ts uses for
  // salons.next_invoice_seq, but scoped to a small dedicated counter table
  // since this counter must reset every financial year rather than grow
  // forever. Retries on the (salon_id, invoice_no) unique-constraint
  // collision the same way, via a SAVEPOINT.
  async create(salonId: string, input: CreateInvoiceInput, createdByUserId: string | null): Promise<SalonClientInvoiceWithItems> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const invoiceDate = new Date(input.invoice_date);
      const financialYear = financialYearFor(invoiceDate);

      const lineItems = input.line_items.map((li) => ({
        description: li.description,
        sac_code: li.sac_code ?? null,
        qty: li.qty,
        rate: li.rate,
        amount: li.qty * li.rate,
      }));
      const subtotal = lineItems.reduce((sum, li) => sum + li.amount, 0);
      const gstAmount = Math.round(subtotal * 0.18 * 100) / 100;
      const totalAmount = subtotal + gstAmount;

      let invoice: SalonClientInvoiceRow | null = null;
      const MAX_ATTEMPTS = 5;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await client.query("SAVEPOINT invoice_insert_attempt");
        try {
          await client.query(
            `INSERT INTO salon_gst_invoice_counters (salon_id, financial_year, next_seq)
             VALUES ($1, $2, 2)
             ON CONFLICT (salon_id, financial_year) DO NOTHING`,
            [salonId, financialYear]
          );
          const { rows: seqRows } = await client.query(
            `UPDATE salon_gst_invoice_counters SET next_seq = next_seq + 1
             WHERE salon_id = $1 AND financial_year = $2
             RETURNING next_seq - 1 AS seq`,
            [salonId, financialYear]
          );
          const seq = seqRows[0].seq;
          const invoiceNo = `FY${financialYear}/${String(seq).padStart(2, "0")}`;

          const { rows: invRows } = await client.query(
            `INSERT INTO salon_client_invoices (
               salon_id, invoice_no, financial_year, invoice_date, branch,
               customer_name, customer_address, customer_contact, customer_email, staff_name,
               payment_mode, status, subtotal, gst_amount, total_amount, created_by
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             RETURNING *`,
            [
              salonId, invoiceNo, financialYear, input.invoice_date, input.branch ?? null,
              input.customer_name, input.customer_address ?? null, input.customer_contact ?? null, input.customer_email ?? null, input.staff_name ?? null,
              input.payment_mode ?? null, input.status, subtotal, gstAmount, totalAmount, createdByUserId,
            ]
          );
          invoice = invRows[0];
          await client.query("RELEASE SAVEPOINT invoice_insert_attempt");
          break;
        } catch (err: any) {
          await client.query("ROLLBACK TO SAVEPOINT invoice_insert_attempt");
          if (err?.code === "23505" && attempt < MAX_ATTEMPTS - 1) continue;
          throw err;
        }
      }

      if (!invoice) throw new Error("Failed to allocate invoice number");

      for (const li of lineItems) {
        await client.query(
          `INSERT INTO salon_client_invoice_items (invoice_id, description, sac_code, qty, rate, amount)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [invoice.id, li.description, li.sac_code, li.qty, li.rate, li.amount]
        );
      }

      await client.query("COMMIT");
      return { ...invoice, items: lineItems.map(({ description, sac_code, qty, rate, amount }) => ({ description, sac_code, qty, rate, amount })) };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async listDistinctBranches(salonId: string): Promise<string[]> {
    const { rows } = await pool.query(
      `SELECT DISTINCT branch FROM salon_client_invoices WHERE salon_id = $1 AND branch IS NOT NULL ORDER BY branch`,
      [salonId]
    );
    return rows.map((r) => r.branch);
  },

  // Feeds the Create Invoice form's customer autocomplete — same active/
  // not-blocked scoping as clients.repository.ts's own search(), but a
  // separate query rather than reusing that module directly, since this is
  // reached via the Super Admin JWT (role: super_admin, salonId: null),
  // which the clients module's own /search route doesn't accept (it's
  // gated to a salon's own staff JWT via ownerAdminStaff).
  async searchClients(salonId: string, q: string, limit: number) {
    const needle = q.trim().toLowerCase();
    const term = `%${needle}%`;
    const { rows } = await pool.query(
      `SELECT id, full_name, email, phone_number, address
       FROM clients
       WHERE salon_id = $1 AND is_active = true AND is_blocked = false
         AND (LOWER(full_name) LIKE $2 OR LOWER(COALESCE(phone_number, '')) LIKE $2)
       ORDER BY full_name ASC
       LIMIT $3`,
      [salonId, term, limit]
    );
    return rows;
  },
};
