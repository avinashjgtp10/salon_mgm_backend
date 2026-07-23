import pool, { safeQuery } from "../../config/database";
import {
    SalesSummaryReportRow,
    SaleDetailHeader,
    SaleDetailItem,
    SaleDetailPayment,
    SaleDetailResponse,
    DailySheetReportRow,
    DailySheetFiltersAvailable,
    ProductRetailReportRow,
    ProductRetailReportStats,
    ProductRetailFilterOption,
    ServiceSaleReportRow,
    ServiceSaleReportStats,
    GstReportRow,
    GstReportStats,
    ProductMarginReportRow,
    ProductMarginReportStats,
    RewardPointsReportRow,
    RewardPointsReportStats,
    EwalletReportRow,
    EwalletReportStats,
    ClientRevenueReportRow,
    ClientRevenueReportStats,
    StaffSalesReportRow,
    StaffItemSalesReportRow,
    StaffItemSalesReportStats,
    PackageSaleReportRow,
    PackageSaleReportStats,
    PackageHistoryReportRow,
    PackageHistoryReportStats,
    MemberSaleReportRow,
    MemberSaleReportStats,
    AppointmentDetailReportRow,
} from "./reports.types";

// ======================================================
// SALES SUMMARY REPORT (independent report API)
// POST /api/report/sales-summary — reads sales/sale_items/payments directly.
// Never calls the Appointment API/service; appointments is only ever JOINed
// (via sales.appointment_id) for wallet/reward context that lives on payments.
// ======================================================

export const reportsRepository = {

_buildSalesSummaryWhere(
  salonId: string,
  filters: {
    start_date?: string;
    end_date?: string;
    staff_id?: string;
    search?: string;
    status?: string;
  }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["s.salon_id = $1"];
  let idx = 2;

  if (filters.status) {
    where.push(`s.status = $${idx++}`);
    values.push(filters.status);
  } else {
    where.push(`s.status <> 'draft'`);
  }

  if (filters.start_date) {
    where.push(`s.created_at >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    where.push(`s.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.staff_id) {
    where.push(`s.staff_id = $${idx++}`);
    values.push(filters.staff_id);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(s.invoice_number, '') ILIKE $${idx}
      OR COALESCE(c.full_name, '') ILIKE $${idx}
      OR COALESCE(c.phone_number, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

// Lateral join reused by both the stats and rows queries — keyed strictly on
// sales.appointment_id, since payments has no sale_id column. For walk-in
// sales (appointment_id IS NULL) this naturally yields 0 for every wallet/
// reward/referral figure — a real schema gap (payments can't be linked to an
// appointment-less sale at all), not a bug in this query.
_PAYMENT_LATERAL: `
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(p.paid_amount) FILTER (WHERE p.status IN ('completed', 'partial', 'refunded')), 0) AS paid_from_payments,
      COALESCE(MAX(p.due_amount) FILTER (
        WHERE p.created_at = (SELECT MAX(p2.created_at) FROM payments p2 WHERE p2.appointment_id = s.appointment_id)
      ), 0) AS latest_due,
      COALESCE(SUM(p.ewallet_used), 0) AS ewallet_used,
      COALESCE(SUM(p.membership_wallet_used), 0) AS membership_wallet_used,
      COALESCE(SUM(p.reward_points_value), 0) AS reward_points_value,
      COALESCE(SUM(p.referral_credit_used), 0) AS referral_credit_used
    FROM payments p
    WHERE p.appointment_id = s.appointment_id AND s.appointment_id IS NOT NULL
  ) pay ON TRUE
`,

async getSalesSummaryReportStats(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; staff_id?: string;
    search?: string; status?: string;
  }
): Promise<{
  total_bill: number; total_sale: number; received_amount: number; total_tip: number;
  total_ewallet: number; total_membership: number; total_rewards: number; total_referral: number;
}> {
  const { where, values } = this._buildSalesSummaryWhere(salonId, filters);

  const query = `
    SELECT
      COUNT(*)::int AS total_bill,
      COALESCE(SUM(s.total_amount::numeric), 0) AS total_sale,
      COALESCE(SUM(
        CASE
          WHEN s.appointment_id IS NOT NULL THEN pay.paid_from_payments
          WHEN s.status = 'completed' THEN s.total_amount::numeric
          ELSE 0
        END
      ), 0) AS received_amount,
      COALESCE(SUM(s.tip_amount::numeric), 0) AS total_tip,
      COALESCE(SUM(pay.ewallet_used), 0) AS total_ewallet,
      COALESCE(SUM(pay.membership_wallet_used), 0) AS total_membership,
      COALESCE(SUM(pay.reward_points_value), 0) AS total_rewards,
      COALESCE(SUM(pay.referral_credit_used), 0) AS total_referral
    FROM sales s
    LEFT JOIN clients c ON s.client_id = c.id
    ${this._PAYMENT_LATERAL}
    WHERE ${where}
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  return {
    total_bill: Number(r.total_bill ?? 0),
    total_sale: Number(r.total_sale ?? 0),
    received_amount: Number(r.received_amount ?? 0),
    total_tip: Number(r.total_tip ?? 0),
    total_ewallet: Number(r.total_ewallet ?? 0),
    total_membership: Number(r.total_membership ?? 0),
    total_rewards: Number(r.total_rewards ?? 0),
    total_referral: Number(r.total_referral ?? 0),
  };
},

async getSalesSummaryReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; staff_id?: string; search?: string;
    status?: string; page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: SalesSummaryReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildSalesSummaryWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    SELECT
      s.id, s.invoice_number, s.status, s.created_at, s.payment_method,
      s.appointment_id,
      s.subtotal AS actual_price, s.total_amount AS price, s.tip_amount,
      c.full_name AS client_name, c.phone_number AS client_phone,
      NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff_name,
      COALESCE(items.item_description, '—') AS item_description,
      COALESCE(items.item_types, '—') AS item_types,
      CASE
        WHEN s.appointment_id IS NOT NULL THEN pay.paid_from_payments
        WHEN s.status = 'completed' THEN s.total_amount::numeric
        ELSE 0
      END AS paid_amount,
      COALESCE(pay.latest_due, 0) AS due_amount,
      COALESCE(pay.ewallet_used, 0) AS ewallet_used,
      COALESCE(pay.membership_wallet_used, 0) AS membership_wallet_used,
      COALESCE(pay.reward_points_value, 0) AS reward_points_value,
      COALESCE(pay.referral_credit_used, 0) AS referral_credit_used,
      COUNT(*) OVER() AS total_count
    FROM sales s
    LEFT JOIN clients c ON s.client_id = c.id
    -- Sales don't always carry their own staff_id (e.g. membership/package/
    -- product-only sales record staff per line item instead) — fall back to
    -- any line item's staff_id, same COALESCE(si.staff_id, s.staff_id)
    -- convention already used by sales.repository.ts::findItemsBySaleId().
    LEFT JOIN staff st ON st.id = COALESCE(
      s.staff_id,
      (SELECT si.staff_id FROM sale_items si WHERE si.sale_id = s.id AND si.staff_id IS NOT NULL LIMIT 1)
    )
    ${this._PAYMENT_LATERAL}
    LEFT JOIN LATERAL (
      SELECT
        STRING_AGG(DISTINCT si.name, ', ') AS item_description,
        STRING_AGG(DISTINCT si.item_type, ', ') AS item_types
      FROM sale_items si
      WHERE si.sale_id = s.id
    ) items ON TRUE
    WHERE ${where}
    ORDER BY s.created_at DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: SalesSummaryReportRow[] = rows.map((row: any) => ({
    id: row.id,
    appointment_id: row.appointment_id,
    invoice_number: row.invoice_number,
    client_name: row.client_name,
    client_phone: row.client_phone,
    item_description: row.item_description,
    item_types: row.item_types,
    actual_price: Number(row.actual_price ?? 0),
    price: Number(row.price ?? 0),
    paid_amount: Number(row.paid_amount ?? 0),
    due_amount: Number(row.due_amount ?? 0),
    tip_amount: Number(row.tip_amount ?? 0),
    ewallet_used: Number(row.ewallet_used ?? 0),
    membership_wallet_used: Number(row.membership_wallet_used ?? 0),
    reward_points_value: Number(row.reward_points_value ?? 0),
    referral_credit_used: Number(row.referral_credit_used ?? 0),
    payment_method: row.payment_method,
    status: row.status,
    created_at: row.created_at,
    staff_name: row.staff_name,
  }));
  const effectiveLimit = limit ?? Math.max(total, 1);
  return {
    items,
    pagination: {
      total,
      page: limit ? page : 1,
      limit: effectiveLimit,
      total_pages: Math.max(1, Math.ceil(total / effectiveLimit)),
    },
  };
},

async getSaleDetail(salonId: string, saleId: string): Promise<SaleDetailResponse> {
  const { rows: saleRows } = await safeQuery(() => pool.query(
    `SELECT
      s.id, s.invoice_number, s.status, s.created_at, s.appointment_id,
      s.subtotal, s.discount_amount, s.tip_amount, s.tax_amount, s.ex_charges, s.total_amount,
      s.payment_method, s.payment_reference, s.notes,
      s.coupon_code, s.discount_percent, s.discount_type,
      c.full_name AS client_name, c.phone_number AS client_phone,
      NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff_name
    FROM sales s
    LEFT JOIN clients c ON s.client_id = c.id
    LEFT JOIN staff st ON st.id = COALESCE(
      s.staff_id,
      (SELECT si.staff_id FROM sale_items si WHERE si.sale_id = s.id AND si.staff_id IS NOT NULL LIMIT 1)
    )
    WHERE s.id = $1 AND s.salon_id = $2`,
    [saleId, salonId]
  ));
  const saleRow = saleRows[0];
  if (!saleRow) {
    return { sale: null, items: [], payment: null };
  }

  const sale: SaleDetailHeader = {
    id: saleRow.id,
    invoice_number: saleRow.invoice_number,
    status: saleRow.status,
    created_at: saleRow.created_at,
    client_name: saleRow.client_name,
    client_phone: saleRow.client_phone,
    staff_name: saleRow.staff_name,
    subtotal: Number(saleRow.subtotal ?? 0),
    discount_amount: Number(saleRow.discount_amount ?? 0),
    tip_amount: Number(saleRow.tip_amount ?? 0),
    tax_amount: Number(saleRow.tax_amount ?? 0),
    ex_charges: Number(saleRow.ex_charges ?? 0),
    total_amount: Number(saleRow.total_amount ?? 0),
    payment_method: saleRow.payment_method,
    payment_reference: saleRow.payment_reference,
    notes: saleRow.notes,
    coupon_code: saleRow.coupon_code,
    discount_percent: saleRow.discount_percent != null ? Number(saleRow.discount_percent) : null,
    discount_type: saleRow.discount_type,
    appointment_id: saleRow.appointment_id,
  };

  const { rows: itemRows } = await safeQuery(() => pool.query(
    `SELECT
      si.id, si.item_type, si.item_id, si.name, si.quantity, si.unit_price,
      si.discount_amount, si.total_price,
      NULLIF(TRIM(CONCAT(COALESCE(st2.first_name, ''), ' ', COALESCE(st2.last_name, ''))), '') AS staff_name
    FROM sale_items si
    LEFT JOIN staff st2 ON st2.id = COALESCE(si.staff_id, (SELECT staff_id FROM sales WHERE id = si.sale_id))
    WHERE si.sale_id = $1`,
    [saleId]
  ));
  const items: SaleDetailItem[] = itemRows.map((row: any) => ({
    id: row.id,
    item_type: row.item_type,
    item_id: row.item_id,
    name: row.name,
    quantity: Number(row.quantity ?? 0),
    unit_price: Number(row.unit_price ?? 0),
    discount_amount: Number(row.discount_amount ?? 0),
    total_price: Number(row.total_price ?? 0),
    staff_name: row.staff_name,
  }));

  let payment: SaleDetailPayment | null = null;
  if (sale.appointment_id) {
    const { rows: payRows } = await safeQuery(() => pool.query(
      `SELECT
        COALESCE(SUM(p.paid_amount) FILTER (WHERE p.status IN ('completed', 'partial', 'refunded')), 0) AS paid_amount,
        COALESCE(MAX(p.due_amount) FILTER (
          WHERE p.created_at = (SELECT MAX(created_at) FROM payments WHERE appointment_id = $1)
        ), 0) AS due_amount,
        COALESCE(SUM(p.ewallet_used), 0) AS ewallet_used,
        COALESCE(SUM(p.membership_wallet_used), 0) AS membership_wallet_used,
        COALESCE(SUM(p.reward_points_value), 0) AS reward_points_value,
        COALESCE(SUM(p.referral_credit_used), 0) AS referral_credit_used,
        (ARRAY_AGG(p.tax_breakdown ORDER BY p.created_at DESC))[1] AS tax_breakdown
      FROM payments p
      WHERE p.appointment_id = $1`,
      [sale.appointment_id]
    ));
    const payRow = payRows[0];
    if (payRow) {
      payment = {
        paid_amount: Number(payRow.paid_amount ?? 0),
        due_amount: Number(payRow.due_amount ?? 0),
        ewallet_used: Number(payRow.ewallet_used ?? 0),
        membership_wallet_used: Number(payRow.membership_wallet_used ?? 0),
        reward_points_value: Number(payRow.reward_points_value ?? 0),
        referral_credit_used: Number(payRow.referral_credit_used ?? 0),
        tax_breakdown: payRow.tax_breakdown ?? null,
      };
    }
  }

  return { sale, items, payment };
},

// ======================================================
// DAILY SHEET REPORT (independent report API)
// POST /api/report/daily-sheet — reads sales/sale_items directly, one row
// per line item. Never calls the Appointment API/service.
// ======================================================

_buildDailySheetWhere(
  salonId: string,
  filters: {
    date?: string;
    service_id?: string;
    staff_id?: string;
    search?: string;
  }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["s.salon_id = $1", "s.status <> 'draft'"];
  let idx = 2;

  if (filters.date) {
    where.push(`DATE(s.created_at) = $${idx++}::date`);
    values.push(filters.date);
  }
  if (filters.service_id) {
    where.push(`si.item_id = $${idx++}`);
    values.push(filters.service_id);
  }
  if (filters.staff_id) {
    where.push(`COALESCE(si.staff_id, s.staff_id) = $${idx++}`);
    values.push(filters.staff_id);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(s.invoice_number, '') ILIKE $${idx}
      OR COALESCE(c.full_name, '') ILIKE $${idx}
      OR COALESCE(c.phone_number, '') ILIKE $${idx}
      OR COALESCE(si.name, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

async getDailySheetReport(
  salonId: string,
  filters: {
    date?: string; service_id?: string; staff_id?: string; search?: string;
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: DailySheetReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
  total_amount: number;
}> {
  const { where, values, nextIndex } = this._buildDailySheetWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    SELECT
      s.appointment_id,
      s.id AS sale_id,
      TO_CHAR(s.created_at, 'HH12:MI AM') AS time,
      COALESCE(s.invoice_number, s.id::text) AS ticket_no,
      c.full_name AS client_name,
      si.item_id AS service_id,
      si.name AS service,
      st.id AS staff_id,
      NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff,
      si.total_price AS amount,
      s.payment_method,
      SUM(si.total_price) OVER() AS grand_total,
      COUNT(*) OVER() AS total_count
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN clients c ON s.client_id = c.id
    LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
    WHERE ${where}
    ORDER BY s.created_at ASC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const totalAmount = rows.length ? Number(rows[0].grand_total ?? 0) : 0;
  const items: DailySheetReportRow[] = rows.map((row: any) => ({
    appointment_id: row.appointment_id,
    sale_id: row.sale_id,
    time: row.time,
    ticket_no: row.ticket_no,
    client_name: row.client_name,
    service_id: row.service_id,
    service: row.service,
    staff_id: row.staff_id,
    staff: row.staff,
    amount: Number(row.amount ?? 0),
    payment_method: row.payment_method,
  }));
  const effectiveLimit = limit ?? Math.max(total, 1);
  return {
    items,
    pagination: {
      total,
      page: limit ? page : 1,
      limit: effectiveLimit,
      total_pages: Math.max(1, Math.ceil(total / effectiveLimit)),
    },
    total_amount: totalAmount,
  };
},

// Distinct services/staff that have EVER appeared in this salon's sales —
// scoped only to salon_id, not the current date/filters, so the dropdown
// options stay complete and stable no matter what's currently selected.
// Zero separate /services or /staff API calls needed on the frontend.
async getDailySheetFiltersAvailable(salonId: string): Promise<DailySheetFiltersAvailable> {
  const { rows: serviceRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT si.item_id AS id, si.name AS label
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     WHERE s.salon_id = $1 AND s.status <> 'draft' AND si.item_id IS NOT NULL
     ORDER BY si.name ASC`,
    [salonId]
  ));

  const { rows: staffRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT st.id, TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))) AS label
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
     WHERE s.salon_id = $1 AND s.status <> 'draft'
     ORDER BY label ASC`,
    [salonId]
  ));

  return {
    services: serviceRows.map((r: any) => ({ id: r.id, label: r.label })),
    staff: staffRows.map((r: any) => ({ id: r.id, label: r.label })),
  };
},

// ======================================================
// PRODUCT RETAIL REPORT (independent report API)
// POST /api/report/product-retail — reads sales/sale_items directly
// (item_type = 'product'), one row per line item. Never calls the
// Appointment API/service.
// ======================================================

_buildProductRetailWhere(
  salonId: string,
  filters: {
    start_date?: string;
    end_date?: string;
    product_id?: string;
    search?: string;
  }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["s.salon_id = $1", "s.status <> 'draft'", "si.item_type = 'product'"];
  let idx = 2;

  if (filters.start_date) {
    where.push(`s.created_at >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    where.push(`s.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.product_id) {
    where.push(`si.item_id = $${idx++}`);
    values.push(filters.product_id);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(s.invoice_number, '') ILIKE $${idx}
      OR COALESCE(c.full_name, '') ILIKE $${idx}
      OR COALESCE(c.phone_number, '') ILIKE $${idx}
      OR COALESCE(si.name, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

async getProductRetailReportStats(
  salonId: string,
  filters: { start_date?: string; end_date?: string; product_id?: string; search?: string }
): Promise<ProductRetailReportStats> {
  const { where, values } = this._buildProductRetailWhere(salonId, filters);

  const query = `
    SELECT
      COALESCE(SUM(si.quantity), 0)::int AS total_quantity,
      COALESCE(SUM(si.total_price), 0) AS total_revenue,
      COUNT(DISTINCT si.name)::int AS unique_products,
      COUNT(*)::int AS line_items
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN clients c ON s.client_id = c.id
    WHERE ${where}
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  return {
    total_quantity: Number(r.total_quantity ?? 0),
    total_revenue: Number(r.total_revenue ?? 0),
    unique_products: Number(r.unique_products ?? 0),
    line_items: Number(r.line_items ?? 0),
  };
},

async getProductRetailReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; product_id?: string; search?: string;
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: ProductRetailReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildProductRetailWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    SELECT
      s.id AS sale_id,
      TO_CHAR(s.created_at, 'YYYY-MM-DD') AS date,
      COALESCE(s.invoice_number, s.id::text) AS invoice_no,
      s.client_id,
      c.full_name AS client_name,
      si.item_id AS product_id,
      si.name AS product_name,
      si.quantity,
      si.unit_price AS price,
      si.total_price AS total,
      COUNT(*) OVER() AS total_count
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN clients c ON s.client_id = c.id
    WHERE ${where}
    ORDER BY s.created_at DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: ProductRetailReportRow[] = rows.map((row: any) => ({
    sale_id: row.sale_id,
    date: row.date,
    invoice_no: row.invoice_no,
    client_id: row.client_id,
    client_name: row.client_name,
    product_id: row.product_id,
    product_name: row.product_name,
    quantity: Number(row.quantity ?? 0),
    price: Number(row.price ?? 0),
    total: Number(row.total ?? 0),
  }));
  const effectiveLimit = limit ?? Math.max(total, 1);
  return {
    items,
    pagination: {
      total,
      page: limit ? page : 1,
      limit: effectiveLimit,
      total_pages: Math.max(1, Math.ceil(total / effectiveLimit)),
    },
  };
},

// Distinct products that have EVER been sold in this salon — scoped only to
// salon_id, not the current date/filters, so the dropdown stays complete.
// Zero separate /products API call needed on the frontend.
async getProductRetailFiltersAvailable(salonId: string): Promise<{ products: ProductRetailFilterOption[] }> {
  const { rows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT si.item_id AS id, si.name AS label
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     WHERE s.salon_id = $1 AND s.status <> 'draft' AND si.item_type = 'product' AND si.item_id IS NOT NULL
     ORDER BY si.name ASC`,
    [salonId]
  ));
  return { products: rows.map((r: any) => ({ id: r.id, label: r.label })) };
},

// ======================================================
// SERVICE SALE REPORT (independent report API)
// POST /api/report/service-sale — reads sales/sale_items directly
// (item_type = 'service'), one row per line item. Never calls the
// Appointment API/service.
// ======================================================

_buildServiceSaleWhere(
  salonId: string,
  filters: { start_date?: string; end_date?: string; staff_id?: string; search?: string }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["s.salon_id = $1", "s.status <> 'draft'", "si.item_type = 'service'"];
  let idx = 2;

  if (filters.start_date) {
    where.push(`s.created_at >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    where.push(`s.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.staff_id) {
    where.push(`COALESCE(si.staff_id, s.staff_id) = $${idx++}`);
    values.push(filters.staff_id);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(si.name, '') ILIKE $${idx}
      OR COALESCE(c.full_name, '') ILIKE $${idx}
      OR COALESCE(st.first_name, '') ILIKE $${idx}
      OR COALESCE(st.last_name, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

async getServiceSaleReportStats(
  salonId: string,
  filters: { start_date?: string; end_date?: string; staff_id?: string; search?: string }
): Promise<ServiceSaleReportStats> {
  const { where, values } = this._buildServiceSaleWhere(salonId, filters);

  const query = `
    SELECT
      COUNT(*)::int AS services_sold,
      COALESCE(SUM(si.total_price), 0) AS total_revenue,
      COUNT(DISTINCT si.name)::int AS unique_services
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN clients c ON s.client_id = c.id
    LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
    WHERE ${where}
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  const services_sold = Number(r.services_sold ?? 0);
  const total_revenue = Number(r.total_revenue ?? 0);
  return {
    services_sold,
    total_revenue,
    avg_ticket: services_sold > 0 ? total_revenue / services_sold : 0,
    unique_services: Number(r.unique_services ?? 0),
  };
},

async getServiceSaleReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; staff_id?: string; search?: string;
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: ServiceSaleReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildServiceSaleWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    SELECT
      s.id AS sale_id,
      TO_CHAR(s.created_at, 'YYYY-MM-DD') AS date,
      COALESCE(s.invoice_number, s.id::text) AS invoice_no,
      s.client_id,
      c.full_name AS client_name,
      st.id AS staff_id,
      NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff_name,
      si.item_id AS service_id,
      si.name AS service_name,
      si.total_price AS price,
      COUNT(*) OVER() AS total_count
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN clients c ON s.client_id = c.id
    LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
    WHERE ${where}
    ORDER BY s.created_at DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: ServiceSaleReportRow[] = rows.map((row: any) => ({
    sale_id: row.sale_id,
    date: row.date,
    invoice_no: row.invoice_no,
    client_id: row.client_id,
    client_name: row.client_name,
    staff_id: row.staff_id,
    staff_name: row.staff_name,
    service_id: row.service_id,
    service_name: row.service_name,
    price: Number(row.price ?? 0),
  }));
  const effectiveLimit = limit ?? Math.max(total, 1);
  return {
    items,
    pagination: {
      total,
      page: limit ? page : 1,
      limit: effectiveLimit,
      total_pages: Math.max(1, Math.ceil(total / effectiveLimit)),
    },
  };
},

// ======================================================
// GST / TAXES REPORT (independent report API)
// POST /api/report/gst — reads sales directly, one row per invoice. Only
// sales with tax_amount > 0 are included (equivalent of the old report's
// "skip appointments with no tax_breakdown" rule). Never calls the
// Appointment API/service.
// ======================================================

_buildGstWhere(
  salonId: string,
  filters: { start_date?: string; end_date?: string; staff_id?: string; search?: string }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["s.salon_id = $1", "s.status <> 'draft'", "s.tax_amount::numeric > 0"];
  let idx = 2;

  if (filters.start_date) {
    where.push(`s.created_at >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    where.push(`s.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.staff_id) {
    where.push(`s.staff_id = $${idx++}`);
    values.push(filters.staff_id);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(s.invoice_number, '') ILIKE $${idx}
      OR COALESCE(c.full_name, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

async getGstReportStats(
  salonId: string,
  filters: { start_date?: string; end_date?: string; staff_id?: string; search?: string }
): Promise<GstReportStats> {
  const { where, values } = this._buildGstWhere(salonId, filters);

  const query = `
    SELECT
      COUNT(*)::int AS invoices_with_tax,
      COALESCE(SUM(s.tax_amount::numeric), 0) AS total_tax_collected,
      COALESCE(SUM(s.total_amount::numeric), 0) AS total_amount_collected
    FROM sales s
    LEFT JOIN clients c ON s.client_id = c.id
    WHERE ${where}
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  return {
    invoices_with_tax: Number(r.invoices_with_tax ?? 0),
    total_tax_collected: Number(r.total_tax_collected ?? 0),
    total_amount_collected: Number(r.total_amount_collected ?? 0),
  };
},

async getGstReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; staff_id?: string; search?: string;
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: GstReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildGstWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    SELECT
      s.id AS sale_id,
      TO_CHAR(s.created_at, 'YYYY-MM-DD') AS date,
      COALESCE(s.invoice_number, s.id::text) AS invoice_no,
      c.full_name AS client_name,
      GREATEST(s.subtotal::numeric - s.discount_amount::numeric, 0) AS taxable_amount,
      s.tax_amount::numeric AS tax_amount,
      s.total_amount::numeric AS total,
      COUNT(*) OVER() AS total_count
    FROM sales s
    LEFT JOIN clients c ON s.client_id = c.id
    WHERE ${where}
    ORDER BY s.created_at DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: GstReportRow[] = rows.map((row: any) => ({
    sale_id: row.sale_id,
    date: row.date,
    invoice_no: row.invoice_no,
    client_name: row.client_name,
    taxable_amount: Number(row.taxable_amount ?? 0),
    tax_amount: Number(row.tax_amount ?? 0),
    total: Number(row.total ?? 0),
  }));
  const effectiveLimit = limit ?? Math.max(total, 1);
  return {
    items,
    pagination: {
      total,
      page: limit ? page : 1,
      limit: effectiveLimit,
      total_pages: Math.max(1, Math.ceil(total / effectiveLimit)),
    },
  };
},

// ======================================================
// PRODUCT MARGIN REPORT (independent report API)
// POST /api/report/product-margin — reads sale_items (item_type = 'product')
// joined against products.supply_price for cost, aggregated by product name.
// Never calls the Appointment API/service.
// ======================================================

_buildProductMarginWhere(
  salonId: string,
  filters: { start_date?: string; end_date?: string }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["s.salon_id = $1", "s.status <> 'draft'", "si.item_type = 'product'"];
  let idx = 2;

  if (filters.start_date) {
    where.push(`s.created_at >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    where.push(`s.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

// Shared aggregation CTE — groups sale_items by product name, joining
// products.supply_price by item_id first, falling back to a case-insensitive
// name match for line items whose product_id no longer resolves (e.g. a
// deleted/renamed product), same fallback style already used elsewhere in
// this module for staff attribution.
_PRODUCT_MARGIN_AGG(where: string): string {
  return `
    WITH margin_agg AS (
      SELECT
        si.name AS product_name,
        SUM(si.quantity) AS quantity,
        SUM(si.total_price) AS revenue,
        SUM(
          COALESCE(
            (SELECT p.supply_price FROM products p WHERE p.id = si.item_id),
            (SELECT p.supply_price FROM products p WHERE p.salon_id = s.salon_id AND LOWER(p.name) = LOWER(si.name) LIMIT 1),
            0
          )::numeric * si.quantity
        ) AS cost
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${where}
      GROUP BY si.name
    )
  `;
},

async getProductMarginReportStats(
  salonId: string,
  filters: { start_date?: string; end_date?: string }
): Promise<ProductMarginReportStats> {
  const { where, values } = this._buildProductMarginWhere(salonId, filters);

  const query = `
    ${this._PRODUCT_MARGIN_AGG(where)}
    SELECT
      COALESCE(SUM(revenue), 0) AS total_revenue,
      COALESCE(SUM(cost), 0) AS total_cost,
      COALESCE(SUM(revenue - cost), 0) AS total_profit
    FROM margin_agg
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  const total_revenue = Number(r.total_revenue ?? 0);
  const total_profit = Number(r.total_profit ?? 0);
  return {
    total_revenue,
    total_cost: Number(r.total_cost ?? 0),
    total_profit,
    avg_margin_pct: total_revenue > 0 ? Math.round((total_profit / total_revenue) * 1000) / 10 : 0,
  };
},

async getProductMarginReportRows(
  salonId: string,
  filters: { start_date?: string; end_date?: string; page?: number; limit?: number; is_export?: boolean }
): Promise<{
  items: ProductMarginReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildProductMarginWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    ${this._PRODUCT_MARGIN_AGG(where)}
    SELECT
      product_name, quantity, revenue, cost, (revenue - cost) AS profit,
      COUNT(*) OVER() AS total_count
    FROM margin_agg
    ORDER BY (revenue - cost) DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: ProductMarginReportRow[] = rows.map((row: any) => {
    const revenue = Number(row.revenue ?? 0);
    const profit = Number(row.profit ?? 0);
    return {
      product_name: row.product_name,
      quantity: Number(row.quantity ?? 0),
      revenue: Math.round(revenue),
      cost: Math.round(Number(row.cost ?? 0)),
      profit: Math.round(profit),
      margin_pct: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
    };
  });
  const effectiveLimit = limit ?? Math.max(total, 1);
  return {
    items,
    pagination: {
      total,
      page: limit ? page : 1,
      limit: effectiveLimit,
      total_pages: Math.max(1, Math.ceil(total / effectiveLimit)),
    },
  };
},

// ======================================================
// REWARD POINTS REPORT (independent report API)
// POST /api/report/reward-points — reads clients.reward_points_balance and
// reward_points_ledger directly, one row per client. Never calls the
// Appointment API/service.
// ======================================================

_buildRewardPointsWhere(
  salonId: string,
  filters: { search?: string }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["c.salon_id = $1"];
  let idx = 2;

  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(c.full_name, '') ILIKE $${idx}
      OR COALESCE(c.phone_number, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

// Shared aggregation CTE — only clients that have ever had a reward-points
// ledger entry are included (matches the old report's scope: clients with
// zero reward-points history never show up in a "reward points" report).
_REWARD_POINTS_AGG(where: string): string {
  return `
    WITH ledger_agg AS (
      SELECT
        rl.client_id,
        COALESCE(SUM(rl.points) FILTER (WHERE rl.type = 'earn'), 0) AS points_earned,
        COALESCE(SUM(-rl.points) FILTER (WHERE rl.type = 'redeem'), 0) AS points_redeemed,
        MAX(rl.created_at) AS last_activity_at
      FROM reward_points_ledger rl
      GROUP BY rl.client_id
    ),
    reward_agg AS (
      SELECT
        c.id AS client_id,
        c.full_name AS client_name,
        c.phone_number AS mobile,
        COALESCE(c.reward_points_balance, 0) AS points_available,
        COALESCE(la.points_earned, 0) AS points_earned,
        COALESCE(la.points_redeemed, 0) AS points_redeemed,
        la.last_activity_at
      FROM clients c
      JOIN ledger_agg la ON la.client_id = c.id
      WHERE ${where}
    )
  `;
},

async getRewardPointsReportStats(
  salonId: string,
  filters: { search?: string }
): Promise<RewardPointsReportStats> {
  const { where, values } = this._buildRewardPointsWhere(salonId, filters);

  const query = `
    ${this._REWARD_POINTS_AGG(where)}
    SELECT
      COALESCE(SUM(points_available), 0) AS points_available,
      COALESCE(SUM(points_earned), 0) AS total_points_earned,
      COALESCE(SUM(points_redeemed), 0) AS total_points_redeemed
    FROM reward_agg
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  return {
    points_available: Number(r.points_available ?? 0),
    total_points_earned: Number(r.total_points_earned ?? 0),
    total_points_redeemed: Number(r.total_points_redeemed ?? 0),
  };
},

async getRewardPointsReportRows(
  salonId: string,
  filters: { search?: string; page?: number; limit?: number; is_export?: boolean }
): Promise<{
  items: RewardPointsReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildRewardPointsWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    ${this._REWARD_POINTS_AGG(where)}
    SELECT
      client_id, client_name, mobile, points_available, points_earned,
      points_redeemed, last_activity_at,
      COUNT(*) OVER() AS total_count
    FROM reward_agg
    ORDER BY points_available DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: RewardPointsReportRow[] = rows.map((row: any) => ({
    client_id: row.client_id,
    client_name: row.client_name,
    mobile: row.mobile,
    points_available: Number(row.points_available ?? 0),
    points_earned: Number(row.points_earned ?? 0),
    points_redeemed: Number(row.points_redeemed ?? 0),
    last_activity_at: row.last_activity_at,
  }));
  const effectiveLimit = limit ?? Math.max(total, 1);
  return {
    items,
    pagination: {
      total,
      page: limit ? page : 1,
      limit: effectiveLimit,
      total_pages: Math.max(1, Math.ceil(total / effectiveLimit)),
    },
  };
},

// ======================================================
// E-WALLET REPORT (independent report API)
// POST /api/report/ewallet — reads clients.ewallet_balance directly, one
// row per client. Never calls the Appointment API/service. Row-click
// drill-down (breakdown/ledger) keeps using the existing dedicated
// /api/v1/ewallet/:clientId/breakdown and /ledger endpoints.
// ======================================================

_buildEwalletWhere(
  salonId: string,
  filters: { search?: string }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["c.salon_id = $1"];
  let idx = 2;

  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(c.full_name, '') ILIKE $${idx}
      OR COALESCE(c.phone_number, '') ILIKE $${idx}
      OR COALESCE(c.email, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

async getEwalletReportStats(
  salonId: string,
  filters: { search?: string }
): Promise<EwalletReportStats> {
  const { where, values } = this._buildEwalletWhere(salonId, filters);

  const query = `
    SELECT
      COUNT(*)::int AS total_clients,
      COUNT(*) FILTER (WHERE COALESCE(c.ewallet_balance, 0) > 0)::int AS with_balance,
      COALESCE(SUM(c.ewallet_balance), 0) AS total_wallet_value
    FROM clients c
    WHERE ${where}
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  const total_wallet_value = Number(r.total_wallet_value ?? 0);
  const with_balance = Number(r.with_balance ?? 0);
  return {
    total_clients: Number(r.total_clients ?? 0),
    with_balance,
    total_wallet_value,
    avg_balance: with_balance > 0 ? total_wallet_value / with_balance : 0,
  };
},

async getEwalletReportRows(
  salonId: string,
  filters: { search?: string; page?: number; limit?: number; is_export?: boolean }
): Promise<{
  items: EwalletReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildEwalletWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    SELECT
      c.id AS client_id,
      COALESCE(NULLIF(TRIM(c.full_name), ''), '—') AS client_name,
      COALESCE(NULLIF(TRIM(CONCAT(COALESCE(c.phone_country_code, ''), ' ', COALESCE(c.phone_number, ''))), ''), '—') AS phone,
      COALESCE(NULLIF(c.email, ''), '—') AS email,
      COALESCE(c.ewallet_balance, 0) AS balance,
      COUNT(*) OVER() AS total_count
    FROM clients c
    WHERE ${where}
    ORDER BY COALESCE(c.ewallet_balance, 0) DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: EwalletReportRow[] = rows.map((row: any) => ({
    client_id: row.client_id,
    client_name: row.client_name,
    phone: row.phone,
    email: row.email,
    balance: Number(row.balance ?? 0),
  }));
  const effectiveLimit = limit ?? Math.max(total, 1);
  return {
    items,
    pagination: {
      total,
      page: limit ? page : 1,
      limit: effectiveLimit,
      total_pages: Math.max(1, Math.ceil(total / effectiveLimit)),
    },
  };
},

// ======================================================
// CLIENT REVENUE REPORT (independent report API)
// POST /api/report/client-revenue — reads sales/clients directly, grouped
// per client (by client_id when known, else name+phone for walk-ins), one
// row per client. Only status = 'completed' sales count. Never calls the
// Appointment API/service.
// ======================================================

_buildClientRevenueWhere(
  salonId: string,
  filters: { start_date?: string; end_date?: string; search?: string }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["s.salon_id = $1", "s.status = 'completed'"];
  let idx = 2;

  if (filters.start_date) {
    where.push(`s.created_at >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    where.push(`s.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(c.full_name, '') ILIKE $${idx}
      OR COALESCE(c.phone_number, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

// Shared aggregation CTE — groups by client_id when known (real clients),
// falling back to a name+phone composite key for walk-in sales that have no
// client_id at all, so those still aggregate together rather than each
// showing up as a separate "unknown" row.
_CLIENT_REVENUE_AGG(where: string): string {
  return `
    WITH revenue_agg AS (
      SELECT
        s.client_id,
        COALESCE(NULLIF(TRIM(c.full_name), ''), 'Walk-in') AS client_name,
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(c.phone_country_code, ''), ' ', COALESCE(c.phone_number, ''))), ''), '—') AS contact,
        COUNT(*) AS visits,
        SUM(s.total_amount::numeric) AS total_spend,
        MAX(TO_CHAR(s.created_at, 'YYYY-MM-DD')) AS last_visit
      FROM sales s
      LEFT JOIN clients c ON s.client_id = c.id
      WHERE ${where}
      GROUP BY COALESCE(s.client_id::text, CONCAT(c.full_name, '|', c.phone_number)), s.client_id, c.full_name, c.phone_number, c.phone_country_code
    )
  `;
},

async getClientRevenueReportStats(
  salonId: string,
  filters: { start_date?: string; end_date?: string; search?: string }
): Promise<ClientRevenueReportStats> {
  const { where, values } = this._buildClientRevenueWhere(salonId, filters);

  const query = `
    ${this._CLIENT_REVENUE_AGG(where)}
    SELECT
      COUNT(*)::int AS total_clients,
      COALESCE(SUM(total_spend), 0) AS total_revenue,
      (SELECT client_name FROM revenue_agg ORDER BY total_spend DESC LIMIT 1) AS top_client
    FROM revenue_agg
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  const total_clients = Number(r.total_clients ?? 0);
  const total_revenue = Number(r.total_revenue ?? 0);
  return {
    total_clients,
    total_revenue,
    avg_spend_per_client: total_clients > 0 ? total_revenue / total_clients : 0,
    top_client: r.top_client ?? "—",
  };
},

async getClientRevenueReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string;
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: ClientRevenueReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildClientRevenueWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    ${this._CLIENT_REVENUE_AGG(where)}
    SELECT
      client_id, client_name, contact, visits, total_spend, last_visit,
      COUNT(*) OVER() AS total_count
    FROM revenue_agg
    ORDER BY total_spend DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: ClientRevenueReportRow[] = rows.map((row: any) => {
    const visits = Number(row.visits ?? 0);
    const total_spend = Number(row.total_spend ?? 0);
    return {
      client_id: row.client_id,
      client_name: row.client_name,
      contact: row.contact,
      visits,
      total_spend: Math.round(total_spend),
      avg_ticket: visits > 0 ? Math.round(total_spend / visits) : 0,
      last_visit: row.last_visit,
    };
  });
  const effectiveLimit = limit ?? Math.max(total, 1);
  return {
    items,
    pagination: {
      total,
      page: limit ? page : 1,
      limit: effectiveLimit,
      total_pages: Math.max(1, Math.ceil(total / effectiveLimit)),
    },
  };
},

// ======================================================
// STAFF SALES REPORT (independent report API)
// POST /api/report/staff-sales — reads sale_items/sales directly, bucketed
// by period (daily/weekly/monthly/yearly) and optionally filtered to one
// staff member. Never calls the Appointment API/service.
// ======================================================

async getStaffSalesReport(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string;
    period?: "daily" | "weekly" | "monthly" | "yearly";
    staff_id?: string;
  }
): Promise<StaffSalesReportRow[]> {
  const values: any[] = [salonId];
  const where = ["s.salon_id = $1", "s.status <> 'draft'", "si.item_type IN ('service', 'product')"];
  let idx = 2;

  if (filters.start_date) {
    where.push(`s.created_at >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    where.push(`s.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.staff_id) {
    where.push(`COALESCE(si.staff_id, s.staff_id) = $${idx++}`);
    values.push(filters.staff_id);
  }

  const period = filters.period ?? "daily";
  const truncUnit = period === "yearly" ? "year" : period === "monthly" ? "month" : period === "weekly" ? "week" : "day";
  const labelExpr =
    period === "yearly"  ? `TO_CHAR(bucket, 'YYYY')` :
    period === "monthly" ? `TO_CHAR(bucket, 'Mon YY')` :
    period === "weekly"  ? `'W' || TO_CHAR(bucket, 'DD Mon')` :
                            `TO_CHAR(bucket, 'DD Mon')`;

  const query = `
    SELECT
      ${labelExpr} AS label,
      TO_CHAR(bucket, 'YYYY-MM-DD') AS bucket_date,
      COALESCE(SUM(total_price) FILTER (WHERE item_type = 'service'), 0) AS service_revenue,
      COALESCE(SUM(total_price) FILTER (WHERE item_type = 'product'), 0) AS product_revenue
    FROM (
      SELECT
        date_trunc('${truncUnit}', s.created_at) AS bucket,
        si.item_type,
        si.total_price
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE ${where.join(" AND ")}
    ) bucketed
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  return rows.map((row: any) => {
    const service_revenue = Math.round(Number(row.service_revenue ?? 0));
    const product_revenue = Math.round(Number(row.product_revenue ?? 0));
    return {
      label: row.label,
      bucket_date: row.bucket_date,
      service_revenue,
      product_revenue,
      total: service_revenue + product_revenue,
    };
  });
},

// ======================================================
// STAFF ITEM SALES REPORT (independent report API)
// POST /api/report/staff-item-sales — reads sale_items directly, one
// item_type at a time (service/product/membership/package), one row per
// line item. Never calls the Appointment API/service.
// ======================================================

_buildStaffItemSalesWhere(
  salonId: string,
  filters: { start_date?: string; end_date?: string; item_type?: string; staff_id?: string }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId, filters.item_type ?? "service"];
  const where = ["s.salon_id = $1", "s.status <> 'draft'", "si.item_type = $2"];
  let idx = 3;

  if (filters.start_date) {
    where.push(`s.created_at >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    where.push(`s.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.staff_id) {
    where.push(`COALESCE(si.staff_id, s.staff_id) = $${idx++}`);
    values.push(filters.staff_id);
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

async getStaffItemSalesReportStats(
  salonId: string,
  filters: { start_date?: string; end_date?: string; item_type?: string; staff_id?: string }
): Promise<StaffItemSalesReportStats> {
  const { where, values } = this._buildStaffItemSalesWhere(salonId, filters);

  const query = `
    WITH filtered AS (
      SELECT
        si.name,
        si.total_price,
        si.quantity,
        NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff_name,
        s.created_at
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
      WHERE ${where}
    )
    SELECT
      COALESCE(SUM(quantity), 0)::int AS total_quantity,
      COALESCE(SUM(total_price), 0) AS total_revenue,
      (SELECT name FROM filtered GROUP BY name ORDER BY SUM(total_price) DESC LIMIT 1) AS top_item,
      (SELECT COALESCE(staff_name, 'Unknown') FROM filtered ORDER BY total_price DESC LIMIT 1) AS top_staff
    FROM filtered
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  return {
    total_quantity: Number(r.total_quantity ?? 0),
    total_revenue: Number(r.total_revenue ?? 0),
    top_item: r.top_item ?? "—",
    top_staff: r.top_staff ?? "—",
  };
},

async getStaffItemSalesReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; item_type?: string; staff_id?: string;
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: StaffItemSalesReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildStaffItemSalesWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 10));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    SELECT
      COALESCE(si.staff_id, s.staff_id) AS staff_id,
      COALESCE(NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''), 'Unknown') AS staff_name,
      si.name AS item_name,
      si.quantity,
      si.total_price AS revenue,
      TO_CHAR(s.created_at, 'YYYY-MM-DD') AS date,
      COUNT(*) OVER() AS total_count
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
    WHERE ${where}
    ORDER BY si.total_price DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: StaffItemSalesReportRow[] = rows.map((row: any) => ({
    staff_id: row.staff_id,
    staff_name: row.staff_name,
    item_name: row.item_name,
    quantity: Number(row.quantity ?? 0),
    revenue: Math.round(Number(row.revenue ?? 0)),
    date: row.date,
  }));
  const effectiveLimit = limit ?? Math.max(total, 1);
  return {
    items,
    pagination: {
      total,
      page: limit ? page : 1,
      limit: effectiveLimit,
      total_pages: Math.max(1, Math.ceil(total / effectiveLimit)),
    },
  };
},

// ======================================================
// PACKAGE SALE REPORT (independent report API)
// POST /api/report/package-sale — reads client_packages directly, one row
// per package sale. Never calls the Appointment API.
// ======================================================

_buildPackageSaleWhere(
  salonId: string,
  filters: { start_date?: string; end_date?: string; search?: string }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["cp.salon_id = $1"];
  let idx = 2;

  if (filters.start_date) {
    where.push(`cp.created_date >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    where.push(`cp.created_date < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(cp.client_name, '') ILIKE $${idx}
      OR COALESCE(cp.package_name, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

async getPackageSaleReportStats(
  salonId: string,
  filters: { start_date?: string; end_date?: string; search?: string }
): Promise<PackageSaleReportStats> {
  const { where, values } = this._buildPackageSaleWhere(salonId, filters);

  const query = `
    SELECT
      COUNT(*)::int AS packages_sold,
      COALESCE(SUM(cp.total_amount::numeric), 0) AS total_sale_value,
      COALESCE(SUM(cp.paid_amount::numeric), 0) AS total_received,
      COUNT(DISTINCT cp.package_name)::int AS unique_packages
    FROM client_packages cp
    WHERE ${where}
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  return {
    packages_sold: Number(r.packages_sold ?? 0),
    total_sale_value: Number(r.total_sale_value ?? 0),
    total_received: Number(r.total_received ?? 0),
    unique_packages: Number(r.unique_packages ?? 0),
  };
},

async getPackageSaleReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string;
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: PackageSaleReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildPackageSaleWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    SELECT
      cp.id,
      TO_CHAR(cp.created_date, 'YYYY-MM-DD') AS date,
      cp.client_id,
      cp.client_name,
      cp.package_name,
      cp.total_amount,
      cp.paid_amount,
      cp.pending_amount,
      cp.payment_status,
      COUNT(*) OVER() AS total_count
    FROM client_packages cp
    WHERE ${where}
    ORDER BY cp.created_date DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: PackageSaleReportRow[] = rows.map((row: any) => ({
    id: row.id,
    date: row.date,
    client_id: row.client_id,
    client_name: row.client_name,
    package_name: row.package_name,
    total_amount: Number(row.total_amount ?? 0),
    paid_amount: Number(row.paid_amount ?? 0),
    pending_amount: Number(row.pending_amount ?? 0),
    payment_status: row.payment_status,
  }));
  const effectiveLimit = limit ?? Math.max(total, 1);
  return {
    items,
    pagination: {
      total,
      page: limit ? page : 1,
      limit: effectiveLimit,
      total_pages: Math.max(1, Math.ceil(total / effectiveLimit)),
    },
  };
},

// ======================================================
// PACKAGE HISTORY REPORT (independent report API)
// POST /api/report/package-history — reads client_package_session_history
// directly, joined to client_package_services/client_packages, one row per
// session. Never calls the Appointment API.
// ======================================================

_buildPackageHistoryWhere(
  salonId: string,
  filters: { start_date?: string; end_date?: string; search?: string }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["cp.salon_id = $1"];
  let idx = 2;

  if (filters.start_date) {
    where.push(`h.session_date >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    where.push(`h.session_date < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(cp.client_name, '') ILIKE $${idx}
      OR COALESCE(cp.package_name, '') ILIKE $${idx}
      OR COALESCE(cps.service_name, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

async getPackageHistoryReportStats(
  salonId: string,
  filters: { start_date?: string; end_date?: string; search?: string }
): Promise<PackageHistoryReportStats> {
  const { where, values } = this._buildPackageHistoryWhere(salonId, filters);

  const query = `
    SELECT
      COUNT(*)::int AS total_sessions,
      COUNT(*) FILTER (WHERE LOWER(h.status) = 'completed')::int AS completed_sessions,
      COUNT(DISTINCT cp.client_id)::int AS unique_clients,
      COUNT(DISTINCT cp.package_name)::int AS unique_packages
    FROM client_package_session_history h
    JOIN client_package_services cps ON cps.id = h.client_package_service_id
    JOIN client_packages cp ON cp.id = h.client_package_id
    WHERE ${where}
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  return {
    total_sessions: Number(r.total_sessions ?? 0),
    completed_sessions: Number(r.completed_sessions ?? 0),
    unique_clients: Number(r.unique_clients ?? 0),
    unique_packages: Number(r.unique_packages ?? 0),
  };
},

async getPackageHistoryReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string;
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: PackageHistoryReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildPackageHistoryWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    SELECT
      TO_CHAR(h.session_date, 'YYYY-MM-DD') AS date,
      cp.client_id,
      cp.client_name,
      cp.package_name,
      cps.service_name,
      h.session_no,
      h.staff_name AS staff,
      h.status,
      COUNT(*) OVER() AS total_count
    FROM client_package_session_history h
    JOIN client_package_services cps ON cps.id = h.client_package_service_id
    JOIN client_packages cp ON cp.id = h.client_package_id
    WHERE ${where}
    ORDER BY h.session_date DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: PackageHistoryReportRow[] = rows.map((row: any) => ({
    date: row.date,
    client_id: row.client_id,
    client_name: row.client_name,
    package_name: row.package_name,
    service_name: row.service_name,
    session_no: Number(row.session_no ?? 0),
    staff: row.staff,
    status: row.status,
  }));
  const effectiveLimit = limit ?? Math.max(total, 1);
  return {
    items,
    pagination: {
      total,
      page: limit ? page : 1,
      limit: effectiveLimit,
      total_pages: Math.max(1, Math.ceil(total / effectiveLimit)),
    },
  };
},

// ======================================================
// MEMBER SALE REPORT (independent report API)
// POST /api/report/member-sale — reads client_memberships directly, one row
// per membership sale. Never calls the Appointment API.
// ======================================================

_buildMemberSaleWhere(
  salonId: string,
  filters: { start_date?: string; end_date?: string; search?: string }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["cm.salon_id = $1"];
  let idx = 2;

  if (filters.start_date) {
    where.push(`cm.purchased_at >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    where.push(`cm.purchased_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(cm.client_name, '') ILIKE $${idx}
      OR COALESCE(cm.membership_name, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

async getMemberSaleReportStats(
  salonId: string,
  filters: { start_date?: string; end_date?: string; search?: string }
): Promise<MemberSaleReportStats> {
  const { where, values } = this._buildMemberSaleWhere(salonId, filters);

  const query = `
    SELECT
      COUNT(*)::int AS memberships_sold,
      COALESCE(SUM(cm.price_paid::numeric), 0) AS total_revenue,
      COUNT(*) FILTER (WHERE cm.status = 'active')::int AS active_memberships
    FROM client_memberships cm
    WHERE ${where}
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  return {
    memberships_sold: Number(r.memberships_sold ?? 0),
    total_revenue: Number(r.total_revenue ?? 0),
    active_memberships: Number(r.active_memberships ?? 0),
  };
},

async getMemberSaleReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string;
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: MemberSaleReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildMemberSaleWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    SELECT
      cm.id,
      cm.client_id,
      TO_CHAR(cm.purchased_at, 'YYYY-MM-DD') AS purchased_at,
      cm.client_name,
      cm.membership_name,
      cm.price_paid,
      cm.total_sessions,
      cm.used_sessions,
      cm.status,
      COUNT(*) OVER() AS total_count
    FROM client_memberships cm
    WHERE ${where}
    ORDER BY cm.purchased_at DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: MemberSaleReportRow[] = rows.map((row: any) => ({
    id: row.id,
    client_id: row.client_id,
    purchased_at: row.purchased_at,
    client_name: row.client_name,
    membership_name: row.membership_name,
    price_paid: Number(row.price_paid ?? 0),
    total_sessions: Number(row.total_sessions ?? 0),
    used_sessions: Number(row.used_sessions ?? 0),
    status: row.status,
  }));
  const effectiveLimit = limit ?? Math.max(total, 1);
  return {
    items,
    pagination: {
      total,
      page: limit ? page : 1,
      limit: effectiveLimit,
      total_pages: Math.max(1, Math.ceil(total / effectiveLimit)),
    },
  };
},

// ======================================================
// APPOINTMENT DETAIL REPORT (independent report API)
// POST /api/report/appointment-detail — reads the appointments table
// directly (JOIN clients/staff/payments), one row per service in the
// services JSONB array. This queries the DB table directly, which is NOT
// the same as calling the Appointment HTTP API/service (still off-limits).
// ======================================================

async getAppointmentDetailReport(
  salonId: string,
  filters: {
    from?: string; to?: string; statuses?: string[];
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: AppointmentDetailReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const values: any[] = [salonId];
  const where = ["a.salon_id = $1", "a.deleted_at IS NULL"];
  let idx = 2;

  if (filters.from) {
    where.push(`a.scheduled_at >= $${idx++}::date`);
    values.push(filters.from);
  }
  if (filters.to) {
    where.push(`a.scheduled_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.to);
  }
  if (filters.statuses && filters.statuses.length > 0) {
    where.push(`a.status = ANY($${idx++}::text[])`);
    values.push(filters.statuses);
  }

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 10));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    WITH matched AS (
      SELECT a.*
      FROM appointments a
      WHERE ${where.join(" AND ")}
    ),
    exploded AS (
      SELECT
        m.id,
        m.scheduled_at,
        m.duration_minutes,
        m.created_at,
        m.client_id,
        m.staff_id,
        m.status,
        svc.value->>'name' AS service_name,
        NULLIF(svc.value->>'staff_id', '') AS svc_staff_id,
        NULLIF(svc.value->>'staff_name', '') AS svc_staff_name,
        COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0) AS svc_price
      FROM matched m
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(m.services, '[]'::jsonb)) AS svc(value) ON TRUE
    )
    SELECT
      e.id,
      TO_CHAR(e.scheduled_at, 'YYYY-MM-DD') AS appointment_date,
      TO_CHAR(e.scheduled_at, 'HH12:MI AM') AS time,
      TO_CHAR(e.created_at, 'YYYY-MM-DD') AS booked_date,
      c.full_name AS client_name,
      COALESCE(e.service_name, '—') AS service_name,
      COALESCE(
        e.svc_staff_name,
        NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '')
      ) AS staff_name,
      e.duration_minutes AS duration,
      COALESCE(pay.paid_amount, e.svc_price, 0) AS amount,
      pay.payment_method,
      e.status AS payment_status,
      COUNT(*) OVER() AS total_count
    FROM exploded e
    LEFT JOIN clients c ON e.client_id = c.id
    LEFT JOIN staff st ON st.id = COALESCE(
      CASE WHEN e.svc_staff_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN e.svc_staff_id::uuid END,
      e.staff_id
    )
    LEFT JOIN LATERAL (
      SELECT p.payment_method, p.paid_amount
      FROM payments p
      WHERE p.appointment_id = e.id
      ORDER BY p.created_at DESC
      LIMIT 1
    ) pay ON TRUE
    ORDER BY e.scheduled_at DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: AppointmentDetailReportRow[] = rows.map((row: any) => ({
    id: row.id,
    appointment_date: row.appointment_date,
    time: row.time,
    booked_date: row.booked_date,
    client_name: row.client_name,
    service_name: row.service_name,
    staff_name: row.staff_name,
    duration: Number(row.duration ?? 0),
    amount: Number(row.amount ?? 0),
    payment_method: row.payment_method,
    payment_status: row.payment_status,
  }));
  const effectiveLimit = limit ?? Math.max(total, 1);
  return {
    items,
    pagination: {
      total,
      page: limit ? page : 1,
      limit: effectiveLimit,
      total_pages: Math.max(1, Math.ceil(total / effectiveLimit)),
    },
  };
},

};
