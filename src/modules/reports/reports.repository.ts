import pool, { safeQuery } from "../../config/database";
import {
    SalesSummaryReportRow,
    SalesSummaryFiltersAvailable,
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
    ServiceSaleFilterOption,
    GstReportRow,
    GstReportStats,
    ProductMarginReportRow,
    ProductMarginReportStats,
    RewardPointsReportRow,
    RewardPointsReportStats,
    EwalletReportRow,
    EwalletReportStats,
    ProductInventoryReportRow,
    ProductInventoryReportStats,
    WaCampaignReportRow,
    WaCampaignReportStats,
    WaCampaignFiltersAvailable,
    ClientRevenueReportRow,
    ClientRevenueReportStats,
    CustomerFrequencyReportRow,
    CustomerFrequencyReportStats,
    StaffSalesReportRow,
    StaffSalesReportStats,
    StaffPerformanceReportRow,
    StaffPerformanceReportStats,
    StaffPerformanceFiltersAvailable,
    StaffItemSalesReportRow,
    StaffItemSalesReportStats,
    PackageSaleReportRow,
    PackageSaleReportStats,
    PackageSaleFilterOption,
    PackageHistoryReportRow,
    PackageHistoryReportStats,
    PackageHistoryFiltersAvailable,
    MemberSaleReportRow,
    MemberSaleReportStats,
    MemberSaleFiltersAvailable,
    AppointmentDetailReportRow,
    CategoryTotalsRow,
    FootfallRow,
    InvoiceAdjustmentsRow,
    SalesSummaryTableData,
    SalesSummaryTableItemDetail,
    TopItemRow,
    TopStylistRow,
    ClientRatingReportRow,
    ClientRatingReportStats,
} from "./reports.types";

// ======================================================
// LEGACY REPORTS (dev) — free-standing helpers/interfaces used by the
// legacy reportsRepository methods below (mounted at /api/v1/reports).
// ======================================================

export interface ProductRevenueFilters {
    search?: string;
    from?: string;
    to?: string;
    category_id?: string;
    brand_id?: string;
    sales_person?: string;
    payment_mode?: string;
    page?: number;
    limit?: number;
}

const SALES_SUMMARY_ITEM_CTES = `
  WITH normalized_items AS (
    SELECT
      s.id AS sale_id,
      s.client_id,
      s.staff_id AS sale_staff_id,
      si.staff_id AS item_staff_id,
      CASE
        WHEN si.item_type = 'service' AND pm.package_id IS NOT NULL THEN 'package'
        ELSE si.item_type
      END AS item_type,
      COALESCE(
        pm.package_id,
        si.item_id::text,
        LOWER(COALESCE(pm.package_name, si.name, si.item_type))
      ) AS item_id,
      COALESCE(pm.package_name, si.name, 'Item') AS name,
      COALESCE(si.quantity, 1) AS quantity,
      COALESCE(si.unit_price::numeric, 0) AS unit_price,
      COALESCE(si.discount_amount::numeric, 0) AS discount_amount,
      COALESCE(si.total_price::numeric, 0) AS total_price
    FROM sales s
    JOIN sale_items si
      ON si.sale_id = s.id
    LEFT JOIN appointments a
      ON a.id = s.appointment_id
    LEFT JOIN LATERAL (
      SELECT
        NULLIF(pkg.value->>'package_id', '') AS package_id,
        COALESCE(NULLIF(pkg.value->>'name', ''), si.name, 'Package') AS package_name
      FROM jsonb_array_elements(COALESCE(a.package_items, '[]'::jsonb)) AS pkg(value)
      WHERE
        si.item_type = 'service'
        AND (
          NULLIF(pkg.value->>'package_id', '') = si.item_id::text
          OR (
            NULLIF(pkg.value->>'package_id', '') IS NULL
            AND LOWER(COALESCE(pkg.value->>'name', '')) = LOWER(COALESCE(si.name, ''))
            AND COALESCE(NULLIF(pkg.value->>'quantity', '')::int, 1) = COALESCE(si.quantity, 1)
            AND COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0) = COALESCE(si.unit_price::numeric, 0)
          )
        )
      LIMIT 1
    ) pm
      ON TRUE
  )
`;

const APPOINTMENT_SOURCE_SQL = `
  CASE
    WHEN LOWER(COALESCE(a.title, '')) LIKE '%walk%'
      OR a.client_id IS NULL
    THEN 'Walk-in'
    ELSE 'Online'
  END
`;

const APPOINTMENT_BASE_CTES = `
  WITH pay AS (
    SELECT
      p.appointment_id,
      COUNT(*) FILTER (WHERE p.status IN ('completed', 'partial', 'refunded')) AS pay_count,
      MAX(p.due_amount) FILTER (
        WHERE p.created_at = (
          SELECT MAX(p2.created_at)
          FROM payments p2
          WHERE p2.appointment_id = p.appointment_id
        )
      ) AS latest_due,
      MAX(p.payment_method) FILTER (
        WHERE p.created_at = (
          SELECT MAX(p2.created_at)
          FROM payments p2
          WHERE p2.appointment_id = p.appointment_id
        )
      ) AS latest_method,
      MAX(p.status) FILTER (
        WHERE p.created_at = (
          SELECT MAX(p2.created_at)
          FROM payments p2
          WHERE p2.appointment_id = p.appointment_id
        )
      ) AS latest_status
    FROM payments p
    GROUP BY p.appointment_id
  ),
  item_totals AS (
    SELECT
      a.id AS appointment_id,
      COALESCE((
        SELECT SUM(
          COALESCE(NULLIF(svc.value->>'total', '')::numeric,
            COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0)
            *
            COALESCE(
              NULLIF(svc.value->>'qty', '')::numeric,
              NULLIF(svc.value->>'quantity', '')::numeric,
              1
            )
          )
        )
        FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
      ), 0) AS service_total,
      COALESCE((
        SELECT SUM(
          COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0)
          *
          COALESCE(
            NULLIF(pkg.value->>'qty', '')::numeric,
            NULLIF(pkg.value->>'quantity', '')::numeric,
            1
          )
        )
        FROM jsonb_array_elements(COALESCE(a.package_items, '[]'::jsonb)) AS pkg(value)
      ), 0) AS package_total,
      COALESCE((
        SELECT SUM(
          COALESCE(NULLIF(prod.value->>'price', '')::numeric, 0)
          *
          COALESCE(
            NULLIF(prod.value->>'qty', '')::numeric,
            NULLIF(prod.value->>'quantity', '')::numeric,
            1
          )
        )
        FROM jsonb_array_elements(COALESCE(a.product_items, '[]'::jsonb)) AS prod(value)
      ), 0) AS product_total,
      COALESCE((
        SELECT SUM(
          COALESCE(NULLIF(mem.value->>'price', '')::numeric, 0)
          *
          COALESCE(
            NULLIF(mem.value->>'qty', '')::numeric,
            NULLIF(mem.value->>'quantity', '')::numeric,
            1
          )
        )
        FROM jsonb_array_elements(COALESCE(a.membership_items, '[]'::jsonb)) AS mem(value)
      ), 0) AS membership_total
    FROM appointments a
  ),
  metrics AS (
    SELECT
      a.id,
      a.salon_id,
      a.client_id,
      a.staff_id,
      a.service_id,
      a.title,
      a.status,
      a.scheduled_at,
      a.duration_minutes,
      a.sale_id,
      a.created_at,
      a.services,
      a.package_items,
      a.product_items,
      a.membership_items,
      a.discount_value,
      a.discount_type,
      a.ex_charges,
      a.tip_amount,
      a.gst_percent,
      CASE
        WHEN pay.latest_status = 'refunded' OR s.status = 'refunded'
        THEN 'refunded'
        WHEN pay.pay_count > 0 AND COALESCE(pay.latest_due, 1) = 0
        THEN 'paid'
        WHEN pay.pay_count > 0
        THEN 'partial'
        ELSE 'unpaid'
      END AS payment_state,
      COALESCE(pay.latest_method, UPPER(COALESCE(s.payment_method, 'N/A'))) AS payment_method,
      COALESCE(
        s.total_amount::numeric,
        ROUND(
          (
            CASE
              WHEN COALESCE(it.service_total, 0)
                 + COALESCE(it.package_total, 0)
                 + COALESCE(it.product_total, 0)
                 + COALESCE(it.membership_total, 0) = 0
              THEN 0
              ELSE
                (
                  COALESCE(it.service_total, 0)
                  + COALESCE(it.package_total, 0)
                  + COALESCE(it.product_total, 0)
                  + COALESCE(it.membership_total, 0)
                )
                -
                CASE
                  WHEN a.discount_type = 'percentage'
                  THEN (
                    (
                      COALESCE(it.service_total, 0)
                      + COALESCE(it.package_total, 0)
                      + COALESCE(it.product_total, 0)
                      + COALESCE(it.membership_total, 0)
                    ) * COALESCE(a.discount_value::numeric, 0) / 100
                  )
                  ELSE COALESCE(a.discount_value::numeric, 0)
                END
                + COALESCE(a.ex_charges::numeric, 0)
                + (
                  (
                    (
                      COALESCE(it.service_total, 0)
                      + COALESCE(it.package_total, 0)
                      + COALESCE(it.product_total, 0)
                      + COALESCE(it.membership_total, 0)
                    )
                    -
                    CASE
                      WHEN a.discount_type = 'percentage'
                      THEN (
                        (
                          COALESCE(it.service_total, 0)
                          + COALESCE(it.package_total, 0)
                          + COALESCE(it.product_total, 0)
                          + COALESCE(it.membership_total, 0)
                        ) * COALESCE(a.discount_value::numeric, 0) / 100
                      )
                      ELSE COALESCE(a.discount_value::numeric, 0)
                    END
                    + COALESCE(a.ex_charges::numeric, 0)
                  ) * COALESCE(a.gst_percent::numeric, 0) / 100
                )
                + COALESCE(a.tip_amount::numeric, 0)
            END
          ),
          2
        )
      ) AS appointment_amount,
      ${APPOINTMENT_SOURCE_SQL} AS booking_source
    FROM appointments a
    LEFT JOIN sales s
      ON s.appointment_id = a.id
    LEFT JOIN pay
      ON pay.appointment_id = a.id
    LEFT JOIN item_totals it
      ON it.appointment_id = a.id
  )
`;

const SERVICE_REMINDER_BASE_CTES = `
  WITH reminder_logs AS (
    SELECT
      l.id,
      l.salon_id,
      l.client_id,
      l.reference_id,
      l.reference_type,
      l.event_type,
      l.template_name,
      l.status AS log_status,
      -- Converted to IST once, here at the source, so every downstream
      -- TO_CHAR/DATE_TRUNC/DATE() on message_at or reminder_date (several
      -- call sites below) inherits correct IST semantics without needing
      -- its own AT TIME ZONE — wa_automation_logs' sent_at/delivered_at/
      -- read_at/created_at are all timestamptz, formatted in the UTC session
      -- otherwise (see config/database.ts).
      COALESCE(l.read_at, l.delivered_at, l.sent_at, l.created_at) AT TIME ZONE 'Asia/Kolkata' AS message_at,
      DATE(COALESCE(l.sent_at, l.created_at) AT TIME ZONE 'Asia/Kolkata') AS reminder_date,
      l.sent_at,
      l.delivered_at,
      l.read_at,
      l.created_at
    FROM wa_automation_logs l
    WHERE
      l.salon_id = $1
      AND l.event_type IN ('appointment_reminder_24h', 'appointment_reminder_1h')
      AND DATE(COALESCE(l.sent_at, l.created_at)) >= $2
      AND DATE(COALESCE(l.sent_at, l.created_at)) <= $3
  ),
  normalized AS (
    SELECT
      rl.id,
      a.id AS appointment_id,
      rl.salon_id,
      COALESCE(a.client_id, rl.client_id) AS client_id,
      a.staff_id,
      a.scheduled_at,
      rl.message_at,
      rl.reminder_date,
      DATE(a.scheduled_at) AS follow_up_date,
      rl.reference_type,
      rl.event_type,
      rl.template_name,
      c.full_name AS customer_name,
      COALESCE(c.phone_number, '') AS mobile,
      COALESCE(
        NULLIF(svc.value->>'name', ''),
        sv.name,
        'Unknown'
      ) AS service_name,
      COALESCE(
        CONCAT_WS(' ', st.first_name, st.last_name),
        st.first_name,
        'Unknown'
      ) AS staff_name,
      rl.log_status,
      COALESCE(
        NULLIF(svc.value->>'service_id', ''),
        a.service_id::text,
        LOWER(COALESCE(NULLIF(svc.value->>'name', ''), sv.name, 'unknown'))
      ) AS service_key
    FROM reminder_logs rl
    LEFT JOIN appointments a
      ON a.id::text = rl.reference_id
    LEFT JOIN LATERAL jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
      ON TRUE
    LEFT JOIN services sv
      ON sv.id = COALESCE(
        NULLIF(svc.value->>'service_id', '')::uuid,
        a.service_id
      )
    LEFT JOIN clients c
      ON c.id = COALESCE(a.client_id, rl.client_id)
    LEFT JOIN staff st
      ON st.id = a.staff_id
  ),
  enriched AS (
    SELECT
      n.*,
      nv.next_visit_at,
      COUNT(*) OVER (
      PARTITION BY n.client_id, n.service_key
      ) AS visits
    FROM normalized n
    LEFT JOIN LATERAL (
      SELECT MIN(n2.scheduled_at) AS next_visit_at
      FROM normalized n2
      WHERE
        n2.client_id = n.client_id
        AND n2.service_key = n.service_key
        AND n2.scheduled_at > n.scheduled_at
    ) nv
      ON TRUE
  ),
  filtered AS (
    SELECT
      e.*,
      CASE
        WHEN e.log_status = 'READ' THEN 'Completed'
        WHEN e.log_status = 'QUEUED' THEN 'Pending'
        WHEN e.log_status IN ('FAILED', 'SKIPPED') THEN 'Expired'
        ELSE 'Sent'
      END AS status
    FROM enriched e
  ),
  reminder_counts AS (
    SELECT
      client_id,
      COUNT(*) FILTER (WHERE status = 'Completed') AS completed_reminders
    FROM filtered
    GROUP BY client_id
  )
`;

const BALANCE_RECEIVED_PAYMENT_MODE_SQL = `
  CASE
    WHEN LOWER(COALESCE(payment_method_raw, '')) = 'cash' THEN 'Cash'
    WHEN LOWER(COALESCE(payment_method_raw, '')) = 'card' THEN 'Card'
    WHEN LOWER(COALESCE(payment_method_raw, '')) = 'upi' THEN 'UPI'
    WHEN LOWER(COALESCE(payment_method_raw, '')) = 'wallet' THEN 'Wallet'
    WHEN LOWER(COALESCE(payment_method_raw, '')) IN ('bank', 'bank_transfer', 'split') THEN 'Bank'
    WHEN LOWER(COALESCE(payment_method_raw, '')) = 'gift_card' THEN 'Wallet'
    ELSE INITCAP(REPLACE(COALESCE(payment_method_raw, 'N/A'), '_', ' '))
  END
`;

const DAY_WISE_BASE_CTES = `
  WITH filtered_sales AS (
    SELECT *
    FROM sales
    WHERE
      salon_id = $1
      AND LOWER(COALESCE(status::text, '')) = 'completed'
      AND DATE(created_at) >= $4
      AND DATE(created_at) <= $3
  ),
  payment_rollup AS (
    SELECT
      p.appointment_id,
      COALESCE(SUM(p.paid_amount) FILTER (
        WHERE LOWER(COALESCE(p.status, '')) IN ('partial', 'completed')
      ), 0)::numeric AS total_paid,
      COALESCE(MAX(p.due_amount) FILTER (
        WHERE p.created_at = (
          SELECT MAX(p2.created_at)
          FROM payments p2
          WHERE p2.appointment_id = p.appointment_id
        )
      ), 0)::numeric AS latest_due,
      MAX(p.payment_method) FILTER (
        WHERE p.created_at = (
          SELECT MAX(p2.created_at)
          FROM payments p2
          WHERE p2.appointment_id = p.appointment_id
        )
      ) AS latest_method
    FROM payments p
    WHERE p.appointment_id IS NOT NULL
    GROUP BY p.appointment_id
  ),
  sale_item_rollup AS (
    SELECT
      si.sale_id,
      COALESCE(SUM(
        COALESCE(si.unit_price::numeric, 0)
        *
        COALESCE(si.quantity, 1)
      ), 0) AS gross_amount,
      COALESCE(SUM(COALESCE(si.discount_amount::numeric, 0)), 0) AS discount_amount,
      COALESCE(SUM(CASE WHEN si.item_type = 'service' THEN COALESCE(si.quantity, 1) ELSE 0 END), 0) AS service_count,
      COALESCE(SUM(CASE WHEN si.item_type = 'product' THEN COALESCE(si.quantity, 1) ELSE 0 END), 0) AS product_count,
      COALESCE(
        STRING_AGG(
          CASE
            WHEN si.item_type = 'service'
            THEN CONCAT(si.name, ' x', COALESCE(si.quantity, 1))
          END,
          ', ' ORDER BY si.created_at, si.name
        ),
        ''
      ) AS services,
      COALESCE(
        STRING_AGG(
          CASE
            WHEN si.item_type = 'product'
            THEN CONCAT(si.name, ' x', COALESCE(si.quantity, 1))
          END,
          ', ' ORDER BY si.created_at, si.name
        ),
        ''
      ) AS products
    FROM sale_items si
    JOIN filtered_sales fs
      ON fs.id = si.sale_id
    GROUP BY si.sale_id
  ),
  appointment_item_rollup AS (
    SELECT
      a.id AS appointment_id,
      COALESCE((
        SELECT SUM(
          COALESCE(NULLIF(svc.value->>'total', '')::numeric,
            COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0)
            *
            COALESCE(
              NULLIF(svc.value->>'qty', '')::numeric,
              NULLIF(svc.value->>'quantity', '')::numeric,
              1
            )
          )
        )
        FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
      ), 0) AS service_gross_amount,
      COALESCE((
        SELECT SUM(
          COALESCE(NULLIF(prod.value->>'price', '')::numeric, 0)
          *
          COALESCE(
            NULLIF(prod.value->>'qty', '')::numeric,
            NULLIF(prod.value->>'quantity', '')::numeric,
            1
          )
        )
        FROM jsonb_array_elements(COALESCE(a.product_items, '[]'::jsonb)) AS prod(value)
      ), 0) AS product_gross_amount,
      COALESCE((
        SELECT SUM(
          COALESCE(
            NULLIF(svc.value->>'qty', '')::numeric,
            NULLIF(svc.value->>'quantity', '')::numeric,
            1
          )
        )
        FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
      ), 0) AS service_count,
      COALESCE((
        SELECT SUM(
          COALESCE(
            NULLIF(prod.value->>'qty', '')::numeric,
            NULLIF(prod.value->>'quantity', '')::numeric,
            1
          )
        )
        FROM jsonb_array_elements(COALESCE(a.product_items, '[]'::jsonb)) AS prod(value)
      ), 0) AS product_count,
      COALESCE((
        SELECT STRING_AGG(
          CONCAT(
            COALESCE(NULLIF(svc.value->>'name', ''), 'Service'),
            ' x',
            COALESCE(
              NULLIF(svc.value->>'qty', '')::int,
              NULLIF(svc.value->>'quantity', '')::int,
              1
            )
          ),
          ', ' ORDER BY COALESCE(NULLIF(svc.value->>'name', ''), 'Service')
        )
        FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
      ), '') AS services,
      COALESCE((
        SELECT STRING_AGG(
          CONCAT(
            COALESCE(NULLIF(prod.value->>'name', ''), 'Product'),
            ' x',
            COALESCE(
              NULLIF(prod.value->>'qty', '')::int,
              NULLIF(prod.value->>'quantity', '')::int,
              1
            )
          ),
          ', ' ORDER BY COALESCE(NULLIF(prod.value->>'name', ''), 'Product')
        )
        FROM jsonb_array_elements(COALESCE(a.product_items, '[]'::jsonb)) AS prod(value)
      ), '') AS products
    FROM appointments a
    JOIN filtered_sales fs
      ON fs.appointment_id = a.id
  ),
  appointment_staff_rollup AS (
    SELECT
      a.id AS appointment_id,
      COALESCE((
        SELECT STRING_AGG(
          DISTINCT COALESCE(NULLIF(TRIM(COALESCE(svc.value->>'staff_name', '')), ''), 'Unknown'),
          ', ' ORDER BY COALESCE(NULLIF(TRIM(COALESCE(svc.value->>'staff_name', '')), ''), 'Unknown')
        )
        FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
      ), '') AS service_staff_names,
      COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''),
        'Unknown'
      ) AS fallback_staff_name
    FROM appointments a
    JOIN filtered_sales fs
      ON fs.appointment_id = a.id
    LEFT JOIN staff st
      ON st.id = a.staff_id
  ),
  sale_staff_rollup AS (
    SELECT
      staff_lines.sale_id,
      COALESCE(
        STRING_AGG(DISTINCT staff_lines.staff_name, ', ' ORDER BY staff_lines.staff_name),
        'Unknown'
      ) AS staff_names
    FROM (
      SELECT
        s.id AS sale_id,
        COALESCE(
          NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''),
          'Unknown'
        ) AS staff_name
      FROM filtered_sales s
      LEFT JOIN sale_items si
        ON si.sale_id = s.id
      LEFT JOIN staff st
        ON st.id = COALESCE(si.staff_id, s.staff_id)
    ) staff_lines
    GROUP BY staff_lines.sale_id
  ),
  sales_base AS (
    SELECT
      s.id,
      s.salon_id,
      s.client_id,
      s.appointment_id,
      s.created_at,
      DATE(s.created_at AT TIME ZONE 'Asia/Kolkata') AS sale_day,
      s.invoice_number AS invoice_no,
      COALESCE(c.full_name, 'Walk-in Client') AS customer_name,
      COALESCE(c.phone_number, '') AS mobile,
      COALESCE(
        ssr.staff_names,
        NULLIF(asr.service_staff_names, ''),
        asr.fallback_staff_name,
        NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''),
        'Unknown'
      ) AS staff_name,
      COALESCE(NULLIF(sir.services, ''), air.services, '') AS services,
      COALESCE(NULLIF(sir.products, ''), air.products, '') AS products,
      COALESCE(
        NULLIF(sir.gross_amount, 0),
        NULLIF(COALESCE(air.service_gross_amount, 0) + COALESCE(air.product_gross_amount, 0), 0),
        COALESCE(s.subtotal::numeric, 0)
      ) AS gross_amount,
      COALESCE(s.discount_amount::numeric, COALESCE(sir.discount_amount, 0), 0) AS discount_amount,
      COALESCE(s.tax_amount::numeric, 0) AS tax_amount,
      COALESCE(s.total_amount::numeric, 0) AS net_amount,
      CASE
        WHEN s.appointment_id IS NOT NULL AND COALESCE(pr.total_paid, 0) > 0
        THEN COALESCE(pr.total_paid, 0)
        ELSE COALESCE(s.total_amount::numeric, 0)
      END AS collected_amount,
      CASE
        WHEN s.appointment_id IS NOT NULL
        THEN GREATEST(COALESCE(pr.latest_due, 0), 0)
        ELSE 0::numeric
      END AS pending_amount,
      LOWER(COALESCE(pr.latest_method, s.payment_method, 'other')) AS payment_method_raw,
      COALESCE(s.notes, '') AS notes,
      'Completed'::text AS status
    FROM filtered_sales s
    LEFT JOIN appointments a
      ON a.id = s.appointment_id
    LEFT JOIN clients c
      ON c.id = s.client_id
    LEFT JOIN payment_rollup pr
      ON pr.appointment_id = s.appointment_id
    LEFT JOIN sale_item_rollup sir
      ON sir.sale_id = s.id
    LEFT JOIN appointment_item_rollup air
      ON air.appointment_id = s.appointment_id
    LEFT JOIN sale_staff_rollup ssr
      ON ssr.sale_id = s.id
    LEFT JOIN appointment_staff_rollup asr
      ON asr.appointment_id = s.appointment_id
    LEFT JOIN staff st
      ON st.id = s.staff_id
    WHERE
      1 = 1
  ),
  normalized_sales AS (
    SELECT
      sb.*,
      CASE
        WHEN LOWER(COALESCE(sb.payment_method_raw, '')) = 'cash' THEN 'Cash'
        WHEN LOWER(COALESCE(sb.payment_method_raw, '')) = 'card' THEN 'Card'
        WHEN LOWER(COALESCE(sb.payment_method_raw, '')) = 'upi' THEN 'UPI'
        WHEN LOWER(COALESCE(sb.payment_method_raw, '')) = 'wallet' THEN 'Wallet'
        WHEN LOWER(COALESCE(sb.payment_method_raw, '')) IN ('bank', 'bank_transfer', 'split') THEN 'Bank'
        ELSE 'Other'
      END AS payment_mode
    FROM sales_base sb
  ),
  current_sales AS (
    SELECT *
    FROM normalized_sales
    WHERE sale_day >= $2 AND sale_day <= $3
  ),
  previous_sales AS (
    SELECT *
    FROM normalized_sales
    WHERE sale_day >= $4 AND sale_day <= $5
  ),
  appointments_base AS (
    SELECT
      a.id,
      a.salon_id,
      a.client_id,
      DATE(a.created_at AT TIME ZONE 'Asia/Kolkata') AS appointment_day
    FROM appointments a
    WHERE
      a.salon_id = $1
      AND DATE(a.created_at AT TIME ZONE 'Asia/Kolkata') >= $4
      AND DATE(a.created_at AT TIME ZONE 'Asia/Kolkata') <= $3
  ),
  current_appointments AS (
    SELECT *
    FROM appointments_base
    WHERE appointment_day >= $2 AND appointment_day <= $3
  ),
  previous_appointments AS (
    SELECT *
    FROM appointments_base
    WHERE appointment_day >= $4 AND appointment_day <= $5
  ),
  staff_productivity_base AS (
    SELECT
      DATE(s.created_at AT TIME ZONE 'Asia/Kolkata') AS sale_day,
      COALESCE(
        NULLIF(asr.service_staff_names, ''),
        asr.fallback_staff_name,
        NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''),
        'Unknown'
      ) AS staff_name,
      COALESCE(SUM(COALESCE(si.total_price::numeric, 0)), 0) AS revenue,
      COUNT(DISTINCT s.appointment_id) FILTER (
        WHERE s.appointment_id IS NOT NULL
      ) AS appointments,
      COALESCE(SUM(CASE WHEN si.item_type = 'service' THEN COALESCE(si.quantity, 1) ELSE 0 END), 0) AS services
    FROM filtered_sales s
    JOIN sale_items si
      ON si.sale_id = s.id
    LEFT JOIN appointment_staff_rollup asr
      ON asr.appointment_id = s.appointment_id
    LEFT JOIN staff st
      ON st.id = COALESCE(si.staff_id, s.staff_id)
    WHERE
      1 = 1
    GROUP BY
      DATE(s.created_at AT TIME ZONE 'Asia/Kolkata'),
      COALESCE(
        NULLIF(asr.service_staff_names, ''),
        asr.fallback_staff_name,
        NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''),
        'Unknown'
      )
  ),
  current_staff_productivity AS (
    SELECT
      staff_name,
      COALESCE(SUM(revenue), 0) AS revenue,
      COALESCE(SUM(appointments), 0) AS appointments,
      COALESCE(SUM(services), 0) AS services
    FROM staff_productivity_base
    WHERE sale_day >= $2 AND sale_day <= $3
    GROUP BY staff_name
  )
`;

const buildDayWiseContext = (filters: {
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  limit?: number;
  sort_by?: string;
  sort_order?: "asc" | "desc";
}) => {
  const from = filters.from ?? new Date().toISOString().slice(0, 10);
  const to = filters.to ?? from;
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const diffDays = Math.max(
    1,
    Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );

  const prevToDate = new Date(fromDate);
  prevToDate.setUTCDate(prevToDate.getUTCDate() - 1);

  const prevFromDate = new Date(prevToDate);
  prevFromDate.setUTCDate(prevFromDate.getUTCDate() - diffDays + 1);

  return {
    from,
    to,
    diffDays,
    prevFrom: prevFromDate.toISOString().slice(0, 10),
    prevTo: prevToDate.toISOString().slice(0, 10),
  };
};

const buildCouponRedemptionBase = (
  salonId: string,
  filters: {
    from?: string;
    to?: string;
  }
) => {
  const values: any[] = [salonId];
  const where = [
    "s.salon_id = $1",
    "COALESCE(NULLIF(TRIM(s.coupon_code), ''), '') <> ''",
    "s.status IN ('completed', 'refunded')",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const ctes = `
    WITH coupon_sales AS (
      SELECT
        s.id AS sale_id,
        NULLIF(s.invoice_number, '') AS invoice_no,
        UPPER(TRIM(s.coupon_code)) AS coupon_code,
        COALESCE(cp.type, 'flat') AS coupon_type,
        COALESCE(cp.value, 0)::numeric AS coupon_value,
        COALESCE(c.full_name, 'Walk-in Client') AS customer_name,
        COALESCE(c.phone_number, '') AS mobile,
        COALESCE(s.subtotal::numeric, 0) AS order_amount,
        COALESCE(s.discount_amount::numeric, 0) AS discount_amount,
        COALESCE(s.total_amount::numeric, 0) AS net_amount,
        UPPER(COALESCE(s.payment_method, 'N/A')) AS payment_method,
        COALESCE(
          NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''),
          'Unknown'
        ) AS staff_name,
        -- Left as a real timestamptz (not converted here) — this alias is
        -- also returned raw to the JS layer as usedAt further down; a
        -- "timestamp without time zone" (what AT TIME ZONE would produce)
        -- gets parsed by node-postgres using the server process's local
        -- clock, not IST, which would silently corrupt that field depending
        -- on the server's OS timezone. TO_CHAR/DATE_TRUNC call sites below
        -- apply the IST conversion locally instead, since their output is
        -- SQL-formatted text/dates, not a raw value handed back to JS.
        s.created_at AS used_at,
        INITCAP(COALESCE(s.status::text, 'completed')) AS status,
        c.id AS client_id
      FROM sales s
      LEFT JOIN clients c
        ON c.id = s.client_id
      LEFT JOIN staff st
        ON st.id = s.staff_id
      LEFT JOIN LATERAL (
        SELECT cpn.*
        FROM coupons cpn
        WHERE
          UPPER(cpn.code) = UPPER(TRIM(s.coupon_code))
          AND (cpn.salon_id = s.salon_id OR cpn.salon_id IS NULL)
        ORDER BY
          CASE WHEN cpn.salon_id = s.salon_id THEN 0 ELSE 1 END,
          cpn.created_at DESC
        LIMIT 1
      ) cp
        ON TRUE
      WHERE ${where.join(" AND ")}
    )
  `;

  return { values, ctes };
};

const buildProductRevenueSourceQuery = (
  salonId: string,
  filters: ProductRevenueFilters
) => {
  const values: any[] = [salonId];
  const saleWhere = [
    "s.salon_id = $1",
    "s.status IN ('draft', 'completed', 'refunded')",
    "si.item_type = 'product'",
  ];
  const appointmentWhere = [
    "a.salon_id = $1",
    "NOT EXISTS (SELECT 1 FROM sales sx WHERE sx.appointment_id = a.id)",
    "LOWER(COALESCE(a.status::text, '')) NOT IN ('cancelled', 'no-show')",
  ];

  let index = 2;

  if (filters.from) {
    saleWhere.push(`DATE(s.created_at) >= $${index}`);
    appointmentWhere.push(`DATE(a.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    saleWhere.push(`DATE(s.created_at) <= $${index}`);
    appointmentWhere.push(`DATE(a.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const outerWhere: string[] = ["1=1"];

  if (filters.search) {
    outerWhere.push(`(
      pr.product_name ILIKE $${index}
      OR COALESCE(pr.barcode, '') ILIKE $${index}
    )`);
    values.push(`%${filters.search}%`);
    index++;
  }

  if (filters.brand_id) {
    outerWhere.push(`pr.brand_id = $${index}`);
    values.push(filters.brand_id);
    index++;
  }

  if (filters.category_id) {
    outerWhere.push(`pr.category_id = $${index}`);
    values.push(filters.category_id);
    index++;
  }

  if (filters.sales_person) {
    outerWhere.push(`COALESCE(pr.sales_person, '') ILIKE $${index}`);
    values.push(`%${filters.sales_person}%`);
    index++;
  }

  if (filters.payment_mode) {
    outerWhere.push(`UPPER(COALESCE(pr.payment_method, '')) = UPPER($${index})`);
    values.push(filters.payment_mode);
    index++;
  }

  return {
    values,
    whereClause: outerWhere.join(" AND "),
    ctes: `
      ${APPOINTMENT_BASE_CTES},
      sale_product_rows AS (
        SELECT
          p.id,
          p.brand_id,
          p.category_id,
          COALESCE(p.name, si.name, 'Product') AS product_name,
          COALESCE(p.barcode, '') AS barcode,
          COALESCE(pb.name, 'Unassigned') AS brand_name,
          COALESCE(pc.name, 'Unassigned') AS category_name,
          COALESCE(si.quantity, 1) AS quantity,
          COALESCE(si.unit_price::numeric, 0) AS unit_price,
          COALESCE(si.discount_amount::numeric, 0) AS discount,
          COALESCE(si.total_price::numeric, 0) AS total_price,
          COALESCE(p.supply_price, 0)::numeric AS supply_price,
          CASE
            WHEN COALESCE(
              NULLIF(apm.staff_name, ''),
              TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))),
              ''
            ) = ''
            THEN '-'
            ELSE COALESCE(
              NULLIF(apm.staff_name, ''),
              TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, '')))
            )
          END AS sales_person,
          'Sale'::text AS source,
          s.created_at AS sale_date,
          UPPER(COALESCE(m.payment_method, s.payment_method, 'N/A')) AS payment_method,
          CASE
            WHEN m.id IS NOT NULL THEN INITCAP(COALESCE(m.payment_state, 'unpaid'))
            WHEN LOWER(COALESCE(s.status::text, '')) = 'completed' THEN 'Paid'
            WHEN LOWER(COALESCE(s.status::text, '')) = 'draft' THEN 'Pending'
            WHEN LOWER(COALESCE(s.status::text, '')) = 'refunded' THEN 'Refunded'
            ELSE INITCAP(COALESCE(s.status::text, 'pending'))
          END AS payment_status
        FROM sale_items si
        INNER JOIN sales s
          ON s.id = si.sale_id
        LEFT JOIN metrics m
          ON m.id = s.appointment_id
        LEFT JOIN appointments a
          ON a.id = s.appointment_id
        INNER JOIN products p
          ON p.id = si.item_id
        LEFT JOIN product_brands pb
          ON pb.id = p.brand_id
        LEFT JOIN service_categories pc
          ON pc.id = p.category_id
        LEFT JOIN LATERAL (
          SELECT
            NULLIF(TRIM(COALESCE(prod.value->>'staff_name', '')), '') AS staff_name
          FROM jsonb_array_elements(COALESCE(a.product_items, '[]'::jsonb)) AS prod(value)
          WHERE
            NULLIF(prod.value->>'product_id', '') = si.item_id::text
            OR (
              LOWER(COALESCE(prod.value->>'name', '')) = LOWER(COALESCE(p.name, si.name, ''))
              AND COALESCE(NULLIF(prod.value->>'quantity', '')::int, NULLIF(prod.value->>'qty', '')::int, 1) = COALESCE(si.quantity, 1)
              AND COALESCE(NULLIF(prod.value->>'price', '')::numeric, 0) = COALESCE(si.unit_price::numeric, 0)
            )
          LIMIT 1
        ) apm
          ON TRUE
        LEFT JOIN staff st
          ON st.id = COALESCE(si.staff_id, a.staff_id, s.staff_id)
        WHERE ${saleWhere.join(" AND ")}
      ),
      appointment_product_rows AS (
        SELECT
          p.id,
          p.brand_id,
          p.category_id,
          COALESCE(p.name, NULLIF(prod.value->>'name', ''), 'Product') AS product_name,
          COALESCE(p.barcode, '') AS barcode,
          COALESCE(pb.name, 'Unassigned') AS brand_name,
          COALESCE(pc.name, 'Unassigned') AS category_name,
          COALESCE(NULLIF(prod.value->>'quantity', '')::int, NULLIF(prod.value->>'qty', '')::int, 1) AS quantity,
          COALESCE(NULLIF(prod.value->>'price', '')::numeric, 0) AS unit_price,
          0::numeric AS discount,
          COALESCE(NULLIF(prod.value->>'price', '')::numeric, 0)
            * COALESCE(NULLIF(prod.value->>'quantity', '')::int, NULLIF(prod.value->>'qty', '')::int, 1) AS total_price,
          COALESCE(p.supply_price, 0)::numeric AS supply_price,
          CASE
            WHEN COALESCE(
              NULLIF(TRIM(COALESCE(prod.value->>'staff_name', '')), ''),
              TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))),
              ''
            ) = ''
            THEN '-'
            ELSE COALESCE(
              NULLIF(TRIM(COALESCE(prod.value->>'staff_name', '')), ''),
              TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, '')))
            )
          END AS sales_person,
          'Appointment'::text AS source,
          a.created_at AS sale_date,
          UPPER(COALESCE(m.payment_method, 'N/A')) AS payment_method,
          INITCAP(COALESCE(m.payment_state, 'unpaid')) AS payment_status
        FROM appointments a
        INNER JOIN metrics m
          ON m.id = a.id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.product_items, '[]'::jsonb)) AS prod(value)
        LEFT JOIN LATERAL (
          SELECT pr.*
          FROM products pr
          WHERE
            pr.id::text = NULLIF(prod.value->>'product_id', '')
            OR (
              NULLIF(prod.value->>'product_id', '') IS NULL
              AND LOWER(pr.name) = LOWER(COALESCE(prod.value->>'name', ''))
            )
          LIMIT 1
        ) p
          ON TRUE
        LEFT JOIN product_brands pb
          ON pb.id = p.brand_id
        LEFT JOIN service_categories pc
          ON pc.id = p.category_id
        LEFT JOIN staff st
          ON st.id = COALESCE(NULLIF(prod.value->>'staff_id', '')::uuid, a.staff_id)
        WHERE ${appointmentWhere.join(" AND ")}
      ),
      product_rows AS (
        SELECT * FROM sale_product_rows
        UNION ALL
        SELECT * FROM appointment_product_rows
      )
    `,
  };
};

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
    staff_ids?: string[];
    search?: string;
    status?: string;
    category_id?: string;
    category_ids?: string[];
    payment_mode?: string;
    payment_modes?: string[];
    item_type?: string;
    item_types?: string[];
    service_id?: string;
    service_ids?: string[];
    // Filters against the same displayed-status vocabulary as _STATUS_EXPR
    // ('paid' | 'booked' | 'cancelled' | 'refunded'), NOT the raw sales.status
    // column that `status` above filters on — the two are deliberately
    // separate knobs (see getStaffSalesReport's Payment Status filter).
    // Every call site using this filter must have _APPOINTMENT_STATUS_JOIN's
    // `a` alias already joined, same requirement as _STATUS_EXPR itself.
    payment_status?: string;
    payment_statuses?: string[];
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
  if (filters.payment_modes && filters.payment_modes.length > 0) {
    where.push(`s.payment_method = ANY($${idx++}::text[])`);
    values.push(filters.payment_modes);
  } else if (filters.payment_mode) {
    where.push(`s.payment_method = $${idx++}`);
    values.push(filters.payment_mode);
  }
  // Service/Staff/Item Type/Category must all match the SAME line item, not
  // be satisfied independently by different items on a multi-item invoice
  // (e.g. "Staff=John AND Item Type=product" must not pass a sale where John
  // only did a service and someone else sold the product) — one EXISTS with
  // every line-item-level condition ANDed together inside it, rather than a
  // separate EXISTS per filter. Staff also now checks sale_items.staff_id
  // (falling back to sales.staff_id), not just sales.staff_id — sales don't
  // always carry their own staff_id (membership/package/product-only sales
  // record staff per line item instead), so filtering only on sales.staff_id
  // silently missed those.
  {
    const lineItemConditions: string[] = ["si.sale_id = s.id"];
    let needsServicesJoin = false;

    if (filters.staff_ids && filters.staff_ids.length > 0) {
      lineItemConditions.push(`COALESCE(si.staff_id, s.staff_id) = ANY($${idx}::uuid[])`);
      values.push(filters.staff_ids);
      idx++;
    } else if (filters.staff_id) {
      lineItemConditions.push(`COALESCE(si.staff_id, s.staff_id) = $${idx}`);
      values.push(filters.staff_id);
      idx++;
    }
    if (filters.item_types && filters.item_types.length > 0) {
      lineItemConditions.push(`si.item_type = ANY($${idx}::text[])`);
      values.push(filters.item_types);
      idx++;
    } else if (filters.item_type) {
      lineItemConditions.push(`si.item_type = $${idx}`);
      values.push(filters.item_type);
      idx++;
    }
    if (filters.service_ids && filters.service_ids.length > 0) {
      lineItemConditions.push(`si.item_type = 'service'`);
      lineItemConditions.push(`si.item_id = ANY($${idx}::uuid[])`);
      values.push(filters.service_ids);
      idx++;
    } else if (filters.service_id) {
      lineItemConditions.push(`si.item_type = 'service'`);
      lineItemConditions.push(`si.item_id = $${idx}`);
      values.push(filters.service_id);
      idx++;
    }
    if (filters.category_ids && filters.category_ids.length > 0) {
      // A sale only "belongs" to a service category if the SAME line item
      // that satisfies the other filters above is also a service in that
      // category — sales.category has no column of its own, since one
      // invoice can mix categories.
      lineItemConditions.push(`si.item_type = 'service'`);
      lineItemConditions.push(`sv.category_id = ANY($${idx}::uuid[])`);
      values.push(filters.category_ids);
      idx++;
      needsServicesJoin = true;
    } else if (filters.category_id) {
      lineItemConditions.push(`si.item_type = 'service'`);
      lineItemConditions.push(`sv.category_id = $${idx}`);
      values.push(filters.category_id);
      idx++;
      needsServicesJoin = true;
    }

    // Only add the EXISTS at all if at least one line-item-level filter was
    // actually requested — otherwise this would needlessly require the sale
    // to have any line item at all.
    if (lineItemConditions.length > 1) {
      const joinClause = needsServicesJoin
        ? "sale_items si JOIN services sv ON sv.id = si.item_id"
        : "sale_items si";
      where.push(`EXISTS (SELECT 1 FROM ${joinClause} WHERE ${lineItemConditions.join(" AND ")})`);
    }
  }
  if (filters.payment_statuses && filters.payment_statuses.length > 0) {
    where.push(`(
      CASE
        WHEN s.appointment_id IS NOT NULL THEN COALESCE(a.status::text, 'booked')
        WHEN s.status = 'completed' THEN 'paid'
        WHEN s.status = 'cancelled' THEN 'cancelled'
        WHEN s.status = 'refunded' THEN 'refunded'
        ELSE 'booked'
      END
    ) = ANY($${idx++}::text[])`);
    values.push(filters.payment_statuses);
  } else if (filters.payment_status) {
    where.push(`(
      CASE
        WHEN s.appointment_id IS NOT NULL THEN COALESCE(a.status::text, 'booked')
        WHEN s.status = 'completed' THEN 'paid'
        WHEN s.status = 'cancelled' THEN 'cancelled'
        WHEN s.status = 'refunded' THEN 'refunded'
        ELSE 'booked'
      END
    ) = $${idx++}`);
    values.push(filters.payment_status);
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

// A `sales` row only ever gets created once an appointment's balance
// reaches due_amount = 0 (see transaction-recorder.service.ts::
// recordTransaction() and payments.service.ts's "Auto-create sale record
// when calendar payment is fully completed" gate) — a partially-paid or
// not-yet-paid appointment structurally has NO sales row at all, so a
// sales-only report can never show it, regardless of any status filter.
// This CTE fills that gap: one synthetic row per appointment that (a) is
// not cancelled/deleted, (b) has no linked sales row yet (checked via
// NOT EXISTS on sales.appointment_id, not appointments.sale_id, since the
// latter is only set by the explicit checkout endpoint and can lag behind
// an actual auto-created sale). Shaped identically to the sales-side
// SELECT (same column names/order) so the two sides can UNION ALL cleanly.
// Money fields mirror appointments.repository.ts::listBySalonId()'s
// pay_agg CTE (same FILTER predicates) — the proven-correct reference the
// Calendar/Quick Sale UI itself reads.
// NOTE: does NOT take its own salonId parameter slot — it's always embedded
// in a larger query (see getSalesSummaryReportStats/Rows) where $1 is
// already bound to salonId by the sales-side query it's UNIONed with.
_UNBILLED_APPOINTMENT_ROWS_CTE(
  filters: {
    start_date?: string; end_date?: string; staff_id?: string; staff_ids?: string[]; search?: string;
    category_id?: string; category_ids?: string[];
    payment_mode?: string; payment_modes?: string[];
    item_type?: string; item_types?: string[];
    service_id?: string; service_ids?: string[];
    // Same displayed-status vocabulary as _STATUS_EXPR/_buildSalesSummaryWhere's
    // payment_status. An unbilled appointment (this CTE's whole reason for
    // being) can only ever show up here as 'booked' or 'partial' — never
    // 'paid'/'cancelled'/'refunded', since those require a real sales row —
    // so this filters directly on the raw a.status rather than needing the
    // CASE expression those other two use (there's no sales row to branch on).
    payment_status?: string; payment_statuses?: string[];
  },
  startIdx: number
): { sql: string; values: any[]; nextIndex: number } {
  const values: any[] = [];
  const where = [
    "a.salon_id = $1",
    "a.deleted_at IS NULL",
    "a.status NOT IN ('cancelled', 'deleted', 'no-show')",
    "NOT EXISTS (SELECT 1 FROM sales sx WHERE sx.appointment_id = a.id)",
  ];
  let idx = startIdx;

  if (filters.start_date) {
    where.push(`a.scheduled_at >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    where.push(`a.scheduled_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.staff_ids && filters.staff_ids.length > 0) {
    where.push(`a.staff_id = ANY($${idx++}::uuid[])`);
    values.push(filters.staff_ids);
  } else if (filters.staff_id) {
    where.push(`a.staff_id = $${idx++}`);
    values.push(filters.staff_id);
  }
  if (filters.category_ids && filters.category_ids.length > 0) {
    where.push(`EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
      JOIN services sv ON sv.id = NULLIF(svc.value->>'service_id', '')::uuid
      WHERE sv.category_id = ANY($${idx++}::uuid[])
    )`);
    values.push(filters.category_ids);
  } else if (filters.category_id) {
    // Unbilled appointments have no sale_items yet — match against the raw
    // services JSONB via each entry's service_id, joined to services/
    // service_categories, same category semantics as the sales_side filter.
    where.push(`EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
      JOIN services sv ON sv.id = NULLIF(svc.value->>'service_id', '')::uuid
      WHERE sv.category_id = $${idx++}
    )`);
    values.push(filters.category_id);
  }
  if (filters.payment_modes && filters.payment_modes.length > 0) {
    where.push(`EXISTS (
      SELECT 1 FROM payments p
      WHERE p.appointment_id = a.id
        AND p.created_at = (SELECT MAX(p2.created_at) FROM payments p2 WHERE p2.appointment_id = a.id)
        AND p.payment_method = ANY($${idx++}::text[])
    )`);
    values.push(filters.payment_modes);
  } else if (filters.payment_mode) {
    // Unbilled appointments have no sales.payment_method yet — the closest
    // signal is the latest linked payment's method, same source the row's
    // own payment_method column (pay.latest_method) is built from below.
    where.push(`EXISTS (
      SELECT 1 FROM payments p
      WHERE p.appointment_id = a.id
        AND p.created_at = (SELECT MAX(p2.created_at) FROM payments p2 WHERE p2.appointment_id = a.id)
        AND p.payment_method = $${idx++}
    )`);
    values.push(filters.payment_mode);
  }
  // Unbilled appointments store line items across four separate JSONB
  // arrays (one per item type) rather than a unified sale_items table —
  // presence of a non-empty array for the requested type is equivalent to
  // "this bill has at least one item of this type". item_type values outside
  // service/product/membership/package (e.g. gift_card/quick) have no
  // corresponding JSONB array on appointments at all, so they always exclude
  // every unbilled row here — same as before, just extended to multi-select.
  const ITEM_TYPE_ARRAY_COL: Record<string, string> = {
    service: "a.services", product: "a.product_items",
    membership: "a.membership_items", package: "a.package_items",
  };
  if (filters.item_types && filters.item_types.length > 0) {
    const cols = filters.item_types.map((t) => ITEM_TYPE_ARRAY_COL[t]).filter((c): c is string => !!c);
    where.push(cols.length > 0
      ? `(${cols.map((c) => `jsonb_array_length(COALESCE(${c}, '[]'::jsonb)) > 0`).join(" OR ")})`
      : "FALSE");
  } else if (filters.item_type) {
    const arrayCol = ITEM_TYPE_ARRAY_COL[filters.item_type] ?? null;
    where.push(arrayCol ? `jsonb_array_length(COALESCE(${arrayCol}, '[]'::jsonb)) > 0` : "FALSE");
  }
  if (filters.service_ids && filters.service_ids.length > 0) {
    where.push(`EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
      WHERE NULLIF(svc.value->>'service_id', '')::uuid = ANY($${idx++}::uuid[])
    )`);
    values.push(filters.service_ids);
  } else if (filters.service_id) {
    where.push(`EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
      WHERE NULLIF(svc.value->>'service_id', '')::uuid = $${idx++}
    )`);
    values.push(filters.service_id);
  }
  if (filters.payment_statuses && filters.payment_statuses.length > 0) {
    where.push(`COALESCE(a.status::text, 'booked') = ANY($${idx++}::text[])`);
    values.push(filters.payment_statuses);
  } else if (filters.payment_status) {
    where.push(`COALESCE(a.status::text, 'booked') = $${idx++}`);
    values.push(filters.payment_status);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(c.full_name, '') ILIKE $${idx}
      OR COALESCE(c.phone_number, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  const sql = `
    SELECT
      base.id, base.appointment_id, base.invoice_number, base.status, base.created_at,
      base.payment_method, base.client_name, base.client_phone, base.staff_id, base.staff_name,
      base.item_description, base.item_types, base.actual_price,
      -- Manual/coupon discount only — the membership discount is a membership
      -- benefit, grouped into membership_wallet_used below instead, not here
      -- (see the identical split in sales_side above).
      base.manual_discount AS discount_amount,
      (GREATEST(base.items_total - base.manual_discount - base.membership_discount_used, 0)
        * base.gst_percent / 100) AS tax_amount,
      GREATEST(
        GREATEST(base.items_total - base.manual_discount - base.membership_discount_used, 0)
          * (1 + base.gst_percent / 100)
          + base.ex_charges + base.tip_amount,
        0
      ) AS price,
      base.tip_amount,
      base.paid_amount, base.due_amount, base.ewallet_used,
      (base.membership_wallet_used + base.membership_discount_used) AS membership_wallet_used,
      base.reward_points_value, base.referral_credit_used
    FROM (
      SELECT
        a.id,
        a.id AS appointment_id,
        NULL::text AS invoice_number,
        a.status::text AS status,
        a.created_at,
        pay.latest_method AS payment_method,
        c.full_name AS client_name,
        c.phone_number AS client_phone,
        a.staff_id,
        -- Every distinct staff member attributed across this unbilled
        -- appointment's items — each of services/package_items/product_items/
        -- membership_items can carry its own staff_name (assigned per item at
        -- booking time), falling back to the appointment's single staff_id
        -- when an item has none. Same "don't hide the other staff" fix as
        -- sales_side above.
        COALESCE(items.staff_names, NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '')) AS staff_name,
        COALESCE(items.item_description, '—') AS item_description,
        COALESCE(items.item_types, '—') AS item_types,
        COALESCE(items.items_total, 0) AS actual_price,
        COALESCE(items.items_total, 0) AS items_total,
        -- Mirrors totalsUtils.ts::computeTotals() at a coarser grain: taxable =
        -- items_total - discount, then GST applied on that taxable amount using
        -- the flat rate saved on the appointment at booking time
        -- (appointments.gst_percent — set from booking.gst in useAppointment.ts).
        -- The real UI computes GST per item-type bucket against configured tax
        -- rules, which isn't reproducible here without that config; gst_percent
        -- is the single stored number closest to "the rate that was actually
        -- applied to this specific bill".
        (CASE WHEN a.discount_type = 'percentage'
               THEN COALESCE(items.items_total, 0) * (COALESCE(a.discount_value, 0) / 100)
               ELSE COALESCE(a.discount_value, 0) END) AS manual_discount,
        -- Pre-tax reduction from a Discount Balance/Loyalty membership — never
        -- factored into this CTE's price at all before, so a fully
        -- membership-covered unbilled appointment both under-reported its
        -- Discount column AND over-reported price/tax (computed as if the
        -- membership discount never happened).
        COALESCE(pay.membership_discount_used, 0) AS membership_discount_used,
        COALESCE(a.gst_percent, 0) AS gst_percent,
        COALESCE(a.ex_charges, 0) AS ex_charges,
        COALESCE(a.tip_amount, 0) AS tip_amount,
        COALESCE(pay.total_paid, 0) AS paid_amount,
        COALESCE(pay.latest_due, 0) AS due_amount,
        COALESCE(pay.ewallet_used, 0) AS ewallet_used,
        COALESCE(pay.membership_wallet_used, 0) AS membership_wallet_used,
        COALESCE(pay.reward_points_value, 0) AS reward_points_value,
        COALESCE(pay.referral_credit_used, 0) AS referral_credit_used
    FROM appointments a
    LEFT JOIN clients c ON a.client_id = c.id
    LEFT JOIN staff st ON st.id = a.staff_id
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(p.paid_amount) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS total_paid,
        COALESCE(MAX(p.due_amount) FILTER (
          WHERE p.created_at = (SELECT MAX(p2.created_at) FROM payments p2 WHERE p2.appointment_id = a.id)
        ), 0) AS latest_due,
        MAX(p.payment_method) FILTER (
          WHERE p.created_at = (SELECT MAX(p2.created_at) FROM payments p2 WHERE p2.appointment_id = a.id)
        ) AS latest_method,
        COALESCE(SUM(p.ewallet_used) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS ewallet_used,
        COALESCE(SUM(p.membership_wallet_used) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS membership_wallet_used,
        COALESCE(SUM(p.reward_points_value) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS reward_points_value,
        COALESCE(SUM(p.referral_credit_used) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS referral_credit_used,
        -- MAX not SUM — see _PAYMENT_LATERAL's identical comment above.
        COALESCE(MAX(p.membership_discount_used) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS membership_discount_used
      FROM payments p
      WHERE p.appointment_id = a.id
    ) pay ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        STRING_AGG(DISTINCT src.name, ', ') AS item_description,
        STRING_AGG(DISTINCT src.item_type, ', ') AS item_types,
        SUM(src.price * src.quantity) AS items_total,
        NULLIF(STRING_AGG(DISTINCT NULLIF(TRIM(src.staff_name), ''), ', ' ORDER BY NULLIF(TRIM(src.staff_name), '')), '') AS staff_names
      FROM (
        SELECT svc.value->>'name' AS name, 'service' AS item_type,
               COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0) AS price,
               COALESCE(NULLIF(svc.value->>'quantity', '')::numeric, 1) AS quantity,
               svc.value->>'staff_name' AS staff_name
        FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
        UNION ALL
        SELECT pkg.value->>'name', 'package',
               COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0),
               COALESCE(NULLIF(pkg.value->>'quantity', '')::numeric, 1),
               pkg.value->>'staff_name'
        FROM jsonb_array_elements(COALESCE(a.package_items, '[]'::jsonb)) AS pkg(value)
        UNION ALL
        SELECT prod.value->>'name', 'product',
               COALESCE(NULLIF(prod.value->>'price', '')::numeric, 0),
               COALESCE(NULLIF(prod.value->>'quantity', '')::numeric, 1),
               prod.value->>'staff_name'
        FROM jsonb_array_elements(COALESCE(a.product_items, '[]'::jsonb)) AS prod(value)
        UNION ALL
        SELECT mem.value->>'name', 'membership',
               COALESCE(NULLIF(mem.value->>'price', '')::numeric, 0),
               COALESCE(NULLIF(mem.value->>'quantity', '')::numeric, 1),
               mem.value->>'staff_name'
        FROM jsonb_array_elements(COALESCE(a.membership_items, '[]'::jsonb)) AS mem(value)
      ) src
    ) items ON TRUE
    WHERE ${where.join(" AND ")}
    ) base
  `;

  return { sql, values, nextIndex: idx };
},

// Lateral join reused by both the stats and rows queries — keyed strictly on
// sales.appointment_id, since payments has no sale_id column. For walk-in
// sales (appointment_id IS NULL) this naturally yields 0 for every wallet/
// reward/referral figure — a real schema gap (payments can't be linked to an
// appointment-less sale at all), not a bug in this query.
// Mirrors appointments.repository.ts::listBySalonId()'s pay_agg CTE exactly
// (same FILTER predicates, same "latest row by created_at" due_amount
// pattern) — that query is what the Calendar/Quick Sale UI actually reads,
// so this is the proven-correct reference, not something to "simplify".
// Note: paid/wallet/reward/referral sums are FILTERed on
// ('completed','partial') only — 'refunded' is deliberately excluded here,
// matching the Appointment API precisely.
_PAYMENT_LATERAL: `
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(p.paid_amount) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS paid_from_payments,
      COALESCE(MAX(p.due_amount) FILTER (
        WHERE p.created_at = (SELECT MAX(p2.created_at) FROM payments p2 WHERE p2.appointment_id = s.appointment_id)
      ), 0) AS latest_due,
      COALESCE(SUM(p.ewallet_used) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS ewallet_used,
      COALESCE(SUM(p.membership_wallet_used) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS membership_wallet_used,
      COALESCE(SUM(p.reward_points_value) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS reward_points_value,
      COALESCE(SUM(p.referral_credit_used) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS referral_credit_used,
      -- Pre-tax price reduction from a Discount Balance/Loyalty membership —
      -- separate column from payments.discount_amount (the manual/coupon
      -- discount) below, see applyMembershipDiscountForBooking. MAX, not SUM
      -- like the fields above: unlike an incremental delta, every payment row
      -- for the same appointment carries the SAME cumulative total (a repeat/
      -- completing call recovers and re-stores it via
      -- getMembershipDiscountForAppointment's own MAX read) — summing across
      -- multiple rows for one appointment (e.g. partial then completing
      -- payment) would double- or triple-count the identical figure.
      COALESCE(MAX(p.membership_discount_used) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS membership_discount_used,
      -- Manual/coupon discount only. NOT the same figure as sales.discount_amount
      -- (which payments.service.ts deliberately folds membership wallet +
      -- membership discount into as well, for its own subtotal-minus-discount
      -- revenue-recognition math) — this one is the customer-facing "discount
      -- applied to the bill" figure the report actually wants to show.
      COALESCE(SUM(p.discount_amount) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS manual_discount_used,
      COUNT(*) FILTER (WHERE p.status IN ('completed', 'partial')) > 0 AS has_payment
    FROM payments p
    WHERE p.appointment_id = s.appointment_id AND s.appointment_id IS NOT NULL
  ) pay ON TRUE
`,

// Every service category in this salon (not just ones with sales) — the
// ticket asks for "all available service categories" in the dropdown, same
// convention as the Product Inventory report's Category filter.
async getSalesSummaryFiltersAvailable(salonId: string): Promise<SalesSummaryFiltersAvailable> {
  const { rows } = await safeQuery(() => pool.query(
    `SELECT id, name AS label
     FROM service_categories
     WHERE salon_id = $1
     ORDER BY display_order ASC, created_at DESC`,
    [salonId]
  ));

  // Staff/services scoped to salon sales only (not the whole salon roster/
  // catalog) — same convention as getDailySheetFiltersAvailable.
  const { rows: staffRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT st.id, TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))) AS label
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
     WHERE s.salon_id = $1 AND s.status <> 'draft'
     ORDER BY label ASC`,
    [salonId]
  ));

  const { rows: serviceRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT si.item_id AS id, si.name AS label
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     WHERE s.salon_id = $1 AND s.status <> 'draft' AND si.item_type = 'service' AND si.item_id IS NOT NULL
     ORDER BY si.name ASC`,
    [salonId]
  ));

  const { rows: paymentModeRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT payment_method
     FROM sales
     WHERE salon_id = $1 AND status <> 'draft' AND payment_method IS NOT NULL
     ORDER BY payment_method ASC`,
    [salonId]
  ));

  return {
    service_categories: rows.map((r: any) => ({ id: r.id, label: r.label })),
    staff: staffRows.map((r: any) => ({ id: r.id, label: r.label })),
    services: serviceRows.map((r: any) => ({ id: r.id, label: r.label })),
    payment_modes: paymentModeRows.map((r: any) => String(r.payment_method)),
  };
},

// LEFT JOIN to appointments, keyed on sales.appointment_id — reused by
// getSalesSummaryReportRows and getDailySheetReport alongside _STATUS_EXPR.
// appointments.status is already correctly maintained by the payment flow
// (booked|partial|paid|cancelled|no-show|deleted) — same column the working
// Appointment Detail report reads directly — so we reuse it as-is rather
// than trying to recompute payment state from the payments table ourselves.
_APPOINTMENT_STATUS_JOIN: `
  LEFT JOIN appointments a ON a.id = s.appointment_id
`,

// Computed status expression reused by getSalesSummaryReportRows and
// getDailySheetReport. For appointment-linked sales, trust
// appointments.status directly (already correct — see
// _APPOINTMENT_STATUS_JOIN). For walk-in sales with no appointment, fall
// back to sales.status, mapped onto the same vocabulary. Requires
// _APPOINTMENT_STATUS_JOIN's `a` alias to already be joined in the same query.
_STATUS_EXPR: `
  CASE
    WHEN s.appointment_id IS NOT NULL THEN COALESCE(a.status::text, 'booked')
    WHEN s.status = 'completed' THEN 'paid'
    WHEN s.status = 'cancelled' THEN 'cancelled'
    WHEN s.status = 'refunded' THEN 'refunded'
    ELSE 'booked'
  END
`,

async getSalesSummaryReportStats(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; staff_id?: string; staff_ids?: string[];
    search?: string; status?: string; category_id?: string; category_ids?: string[];
    payment_mode?: string; payment_modes?: string[];
    item_type?: string; item_types?: string[];
    service_id?: string; service_ids?: string[];
    payment_status?: string; payment_statuses?: string[];
  }
): Promise<{
  total_bill: number; total_sale: number; received_amount: number; total_tip: number;
  total_ewallet: number; total_membership: number; total_rewards: number; total_referral: number;
}> {
  const { where, values, nextIndex } = this._buildSalesSummaryWhere(salonId, filters);
  const unbilled = this._UNBILLED_APPOINTMENT_ROWS_CTE(filters, nextIndex);

  const query = `
    WITH sales_side AS (
      SELECT
        s.total_amount::numeric AS price,
        CASE
          WHEN s.appointment_id IS NOT NULL THEN pay.paid_from_payments
          WHEN s.status = 'completed' THEN s.total_amount::numeric
          ELSE 0
        END AS paid_amount,
        s.tip_amount::numeric AS tip_amount,
        pay.ewallet_used, pay.membership_wallet_used,
        pay.reward_points_value, pay.referral_credit_used
      FROM sales s
      LEFT JOIN clients c ON s.client_id = c.id
      ${this._PAYMENT_LATERAL}
      ${this._APPOINTMENT_STATUS_JOIN}
      WHERE ${where}
    ),
    appt_side AS (
      SELECT
        u.price, u.paid_amount, u.tip_amount,
        u.ewallet_used, u.membership_wallet_used,
        u.reward_points_value, u.referral_credit_used
      FROM (${unbilled.sql}) u
    ),
    unified AS (
      SELECT * FROM sales_side
      UNION ALL
      SELECT * FROM appt_side
    )
    SELECT
      COUNT(*)::int AS total_bill,
      COALESCE(SUM(price), 0) AS total_sale,
      COALESCE(SUM(paid_amount), 0) AS received_amount,
      COALESCE(SUM(tip_amount), 0) AS total_tip,
      COALESCE(SUM(ewallet_used), 0) AS total_ewallet,
      COALESCE(SUM(membership_wallet_used), 0) AS total_membership,
      COALESCE(SUM(reward_points_value), 0) AS total_rewards,
      COALESCE(SUM(referral_credit_used), 0) AS total_referral
    FROM unified
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...unbilled.values]));
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
    start_date?: string; end_date?: string; staff_id?: string; staff_ids?: string[]; search?: string;
    status?: string; category_id?: string; category_ids?: string[]; page?: number; limit?: number; is_export?: boolean;
    payment_mode?: string; payment_modes?: string[];
    item_type?: string; item_types?: string[];
    service_id?: string; service_ids?: string[];
    payment_status?: string; payment_statuses?: string[];
  }
): Promise<{
  items: SalesSummaryReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildSalesSummaryWhere(salonId, filters);
  const unbilled = this._UNBILLED_APPOINTMENT_ROWS_CTE(filters, nextIndex);
  let idx = unbilled.nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    WITH sales_side AS (
      SELECT
        s.id, s.invoice_number, s.created_at, s.payment_method, s.payment_reference,
        s.appointment_id,
        ${this._STATUS_EXPR} AS status,
        s.subtotal AS actual_price, s.total_amount AS price,
        -- Deliberately NOT s.discount_amount — that column is a revenue-
        -- recognition figure (payments.service.ts folds membership wallet +
        -- membership discount into it too, see its recordTransaction() call),
        -- not "the discount shown on the bill". Manual/coupon only — the
        -- membership discount belongs with membership_wallet_used below (it's
        -- a membership benefit, not a generic bill discount), not here.
        COALESCE(pay.manual_discount_used, 0) AS discount_amount,
        -- Stored on the sale itself at checkout (payments.service.ts) —
        -- retrieved here, never recomputed, per report-consistency requirement.
        s.coupon_code AS report_coupon_code,
        COALESCE(s.coupon_discount_amount, 0) AS coupon_discount_amount,
        COALESCE(s.referral_discount_amount, 0) AS referral_discount_amount,
        COALESCE(s.tax_amount, 0) AS tax_amount,
        s.tip_amount,
        c.full_name AS client_name, c.phone_number AS client_phone,
        -- Every distinct staff member attributed across this sale's line
        -- items (falling back to the sale's own staff_id per item, same
        -- COALESCE(si.staff_id, s.staff_id) convention as
        -- sales.repository.ts::findItemsBySaleId()) — a single joined staff
        -- name here used to show only whichever staff happened to be picked
        -- first, hiding every other staff member on a multi-staff sale (e.g.
        -- one staff on the service, another on a retail product).
        COALESCE(items.staff_names, '—') AS staff_name,
        COALESCE(items.item_description, '—') AS item_description,
        COALESCE(items.item_types, '—') AS item_types,
        CASE
          WHEN s.appointment_id IS NOT NULL THEN pay.paid_from_payments
          WHEN s.status = 'completed' THEN s.total_amount::numeric
          ELSE 0
        END AS paid_amount,
        COALESCE(pay.latest_due, 0) AS due_amount,
        COALESCE(pay.ewallet_used, 0) AS ewallet_used,
        -- Both membership benefits combined — wallet redemption AND discount
        -- are each "covered by their membership", one column, not split
        -- across "Membership" and "Discount".
        COALESCE(pay.membership_wallet_used, 0) + COALESCE(pay.membership_discount_used, 0) AS membership_wallet_used,
        COALESCE(pay.reward_points_value, 0) AS reward_points_value,
        COALESCE(pay.referral_credit_used, 0) AS referral_credit_used
      FROM sales s
      LEFT JOIN clients c ON s.client_id = c.id
      ${this._PAYMENT_LATERAL}
      ${this._APPOINTMENT_STATUS_JOIN}
      LEFT JOIN LATERAL (
        SELECT
          STRING_AGG(DISTINCT si.name, ', ') AS item_description,
          STRING_AGG(DISTINCT si.item_type, ', ') AS item_types,
          STRING_AGG(DISTINCT staff_lines.staff_name, ', ' ORDER BY staff_lines.staff_name) AS staff_names
        FROM sale_items si
        LEFT JOIN LATERAL (
          SELECT NULLIF(TRIM(CONCAT(COALESCE(st2.first_name, ''), ' ', COALESCE(st2.last_name, ''))), '') AS staff_name
          FROM staff st2 WHERE st2.id = COALESCE(si.staff_id, s.staff_id)
        ) staff_lines ON TRUE
        WHERE si.sale_id = s.id
      ) items ON TRUE
      WHERE ${where}
    ),
    appt_side AS (
      SELECT
        u.id, u.invoice_number, u.created_at, u.payment_method,
        NULL::text AS payment_reference,
        u.appointment_id, u.status,
        u.actual_price, u.price, u.discount_amount,
        NULL::text AS report_coupon_code, 0::numeric AS coupon_discount_amount, 0::numeric AS referral_discount_amount,
        u.tax_amount, u.tip_amount,
        u.client_name, u.client_phone, u.staff_name,
        u.item_description, u.item_types,
        u.paid_amount, u.due_amount,
        u.ewallet_used, u.membership_wallet_used,
        u.reward_points_value, u.referral_credit_used
      FROM (${unbilled.sql}) u
    ),
    unified AS (
      SELECT * FROM sales_side
      UNION ALL
      SELECT * FROM appt_side
    )
    SELECT *, COUNT(*) OVER() AS total_count
    FROM unified
    ORDER BY created_at DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...unbilled.values, ...limitValues]));
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
    discount_amount: Number(row.discount_amount ?? 0),
    coupon_code: row.report_coupon_code,
    coupon_discount_amount: Number(row.coupon_discount_amount ?? 0),
    referral_discount_amount: Number(row.referral_discount_amount ?? 0),
    tax_amount: Number(row.tax_amount ?? 0),
    paid_amount: Number(row.paid_amount ?? 0),
    due_amount: Number(row.due_amount ?? 0),
    tip_amount: Number(row.tip_amount ?? 0),
    ewallet_used: Number(row.ewallet_used ?? 0),
    membership_wallet_used: Number(row.membership_wallet_used ?? 0),
    reward_points_value: Number(row.reward_points_value ?? 0),
    referral_credit_used: Number(row.referral_credit_used ?? 0),
    payment_method: row.payment_method,
    payment_reference: row.payment_reference,
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
      s.manual_discount_amount, s.coupon_id, s.coupon_discount_amount, s.coupon_discount_type,
      s.referral_discount_amount, s.referral_id, s.referral_source,
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
    manual_discount_amount: Number(saleRow.manual_discount_amount ?? 0),
    coupon_id: saleRow.coupon_id,
    coupon_discount_amount: Number(saleRow.coupon_discount_amount ?? 0),
    coupon_discount_type: saleRow.coupon_discount_type,
    referral_discount_amount: Number(saleRow.referral_discount_amount ?? 0),
    referral_id: saleRow.referral_id,
    referral_source: saleRow.referral_source,
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

// Sale-level filters go in `where` (safe against s./c. columns, which are
// never NULL-able via the sale_items join). item-level filters (service_id,
// staff_id via si., search's si.name arm) go in `saleItemsJoin` instead of
// WHERE — sale_items is now LEFT JOINed (see getDailySheetReport) so a sale
// can still surface even when it happens to have no matching/any line item;
// a WHERE on si.* would silently turn that LEFT JOIN back into an INNER
// JOIN and drop the sale entirely, same class of bug fixed for Client
// Revenue (SCRUM-1066).
_buildDailySheetWhere(
  salonId: string,
  filters: {
    date?: string;
    service_id?: string;
    service_ids?: string[];
    staff_ids?: string[];
    search?: string;
    payment_mode?: string;
    payment_modes?: string[];
    status?: string;
    statuses?: string[];
    item_type?: string;
    item_types?: string[];
    time_from?: string;
    time_to?: string;
  }
): { where: string; saleItemsJoin: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["s.salon_id = $1", "s.status <> 'draft'"];
  const saleItemsJoin = ["si.sale_id = s.id"];
  let idx = 2;

  if (filters.date) {
    where.push(`DATE(s.created_at) = $${idx++}::date`);
    values.push(filters.date);
  }
  if (filters.time_from) {
    where.push(`s.created_at::time >= $${idx++}::time`);
    values.push(filters.time_from);
  }
  if (filters.time_to) {
    where.push(`s.created_at::time <= $${idx++}::time`);
    values.push(filters.time_to);
  }
  // Service/Staff/Item Type must all match the SAME line item, not be
  // satisfied independently by different items on a multi-item sale (e.g.
  // "Staff=John AND Item Type=product" must not pass a sale where John only
  // did a service and someone else sold the product). All three conditions
  // go into both `saleItemsJoin` (so the LEFT-JOINed si row displayed by the
  // outer query is the one actually matching every filter) and a single
  // combined EXISTS re-check (guards against the LEFT JOIN silently
  // admitting the sale with no matching line item at all, same reasoning as
  // the old per-filter EXISTS checks — just combined into one now).
  const lineItemConditions2: string[] = [];
  if (filters.service_ids && filters.service_ids.length > 0) {
    saleItemsJoin.push(`si.item_id = ANY($${idx}::uuid[])`);
    lineItemConditions2.push(`si2.item_id = ANY($${idx}::uuid[])`);
    values.push(filters.service_ids);
    idx++;
  } else if (filters.service_id) {
    saleItemsJoin.push(`si.item_id = $${idx}`);
    lineItemConditions2.push(`si2.item_id = $${idx}`);
    values.push(filters.service_id);
    idx++;
  }
  if (filters.staff_ids && filters.staff_ids.length > 0) {
    saleItemsJoin.push(`COALESCE(si.staff_id, s.staff_id) = ANY($${idx}::uuid[])`);
    lineItemConditions2.push(`COALESCE(si2.staff_id, s.staff_id) = ANY($${idx}::uuid[])`);
    values.push(filters.staff_ids);
    idx++;
  }
  if (filters.item_types && filters.item_types.length > 0) {
    saleItemsJoin.push(`si.item_type = ANY($${idx}::text[])`);
    lineItemConditions2.push(`si2.item_type = ANY($${idx}::text[])`);
    values.push(filters.item_types);
    idx++;
  } else if (filters.item_type) {
    saleItemsJoin.push(`si.item_type = $${idx}`);
    lineItemConditions2.push(`si2.item_type = $${idx}`);
    values.push(filters.item_type);
    idx++;
  }
  if (lineItemConditions2.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM sale_items si2 WHERE si2.sale_id = s.id AND ${lineItemConditions2.join(" AND ")})`);
  }
  if (filters.payment_modes && filters.payment_modes.length > 0) {
    where.push(`s.payment_method = ANY($${idx++}::text[])`);
    values.push(filters.payment_modes);
  } else if (filters.payment_mode) {
    where.push(`s.payment_method = $${idx++}`);
    values.push(filters.payment_mode);
  }
  if (filters.statuses && filters.statuses.length > 0) {
    // Mirrors _STATUS_EXPR (appointment-linked sales trust appointments.status,
    // walk-ins fall back to sales.status mapped onto the same vocabulary) —
    // filtering post-computation since the expression itself needs the
    // _APPOINTMENT_STATUS_JOIN alias `a`, already joined by the caller.
    where.push(`(${this._STATUS_EXPR}) = ANY($${idx++}::text[])`);
    values.push(filters.statuses);
  } else if (filters.status) {
    where.push(`(${this._STATUS_EXPR}) = $${idx++}`);
    values.push(filters.status);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(s.invoice_number, '') ILIKE $${idx}
      OR COALESCE(c.full_name, '') ILIKE $${idx}
      OR COALESCE(c.phone_number, '') ILIKE $${idx}
      OR COALESCE(si.name, '') ILIKE $${idx}
      OR COALESCE(TRIM(CONCAT(st.first_name, ' ', st.last_name)), '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), saleItemsJoin: saleItemsJoin.join(" AND "), values, nextIndex: idx };
},

// Same gap as Sales Summary (see _UNBILLED_APPOINTMENT_ROWS_CTE): a
// partially-paid or not-yet-paid appointment has no sales/sale_items rows
// at all, so Daily Sheet — which reads sale_items — can never show it
// without this. One synthetic row per line item across all four JSONB
// arrays (services/package_items/product_items/membership_items), shaped
// identically to the sale_items-based SELECT so both sides UNION ALL
// cleanly. Does not take its own salonId slot — always embedded where $1
// is already bound (see getDailySheetReport).
_UNBILLED_APPOINTMENT_DAILY_ROWS_CTE(
  filters: {
    date?: string; service_id?: string; service_ids?: string[]; staff_ids?: string[]; search?: string;
    payment_mode?: string; payment_modes?: string[];
    status?: string; statuses?: string[];
    item_type?: string; item_types?: string[];
    time_from?: string; time_to?: string;
  },
  startIdx: number
): { sql: string; values: any[]; nextIndex: number } {
  const values: any[] = [];
  const where = [
    "a.salon_id = $1",
    "a.deleted_at IS NULL",
    "a.status NOT IN ('cancelled', 'deleted', 'no-show')",
    "NOT EXISTS (SELECT 1 FROM sales sx WHERE sx.appointment_id = a.id)",
  ];
  let idx = startIdx;

  if (filters.date) {
    where.push(`DATE(a.scheduled_at) = $${idx++}::date`);
    values.push(filters.date);
  }
  if (filters.time_from) {
    where.push(`a.created_at::time >= $${idx++}::time`);
    values.push(filters.time_from);
  }
  if (filters.time_to) {
    where.push(`a.created_at::time <= $${idx++}::time`);
    values.push(filters.time_to);
  }
  if (filters.service_ids && filters.service_ids.length > 0) {
    where.push(`src.item_id = ANY($${idx++}::text[])`);
    values.push(filters.service_ids);
  } else if (filters.service_id) {
    where.push(`src.item_id = $${idx++}`);
    values.push(filters.service_id);
  }
  if (filters.staff_ids && filters.staff_ids.length > 0) {
    where.push(`COALESCE(src.staff_id, a.staff_id) = ANY($${idx++}::uuid[])`);
    values.push(filters.staff_ids);
  }
  if (filters.payment_modes && filters.payment_modes.length > 0) {
    where.push(`pay.latest_method = ANY($${idx++}::text[])`);
    values.push(filters.payment_modes);
  } else if (filters.payment_mode) {
    where.push(`pay.latest_method = $${idx++}`);
    values.push(filters.payment_mode);
  }
  if (filters.item_types && filters.item_types.length > 0) {
    where.push(`src.item_type = ANY($${idx++}::text[])`);
    values.push(filters.item_types);
  } else if (filters.item_type) {
    where.push(`src.item_type = $${idx++}`);
    values.push(filters.item_type);
  }
  if (filters.statuses && filters.statuses.length > 0) {
    where.push(`a.status::text = ANY($${idx++}::text[])`);
    values.push(filters.statuses);
  } else if (filters.status) {
    where.push(`a.status::text = $${idx++}`);
    values.push(filters.status);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(c.full_name, '') ILIKE $${idx}
      OR COALESCE(c.phone_number, '') ILIKE $${idx}
      OR COALESCE(src.name, '') ILIKE $${idx}
      OR COALESCE(TRIM(CONCAT(st.first_name, ' ', st.last_name)), '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  const sql = `
    SELECT
      a.appointment_id,
      NULL::uuid AS sale_id,
      a.time,
      a.ticket_no,
      a.client_id,
      c.full_name AS client_name,
      src.item_id AS service_id,
      src.name AS service,
      src.item_type,
      st.id AS staff_id,
      NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff,
      (src.price * src.quantity) AS amount,
      pay.latest_method AS payment_method,
      a.status::text AS status,
      pay.total_paid,
      pay.latest_due
    FROM (
      SELECT a.id, a.id AS appointment_id, a.salon_id, a.client_id, a.staff_id, a.status,
             a.created_at, a.scheduled_at, a.deleted_at, a.services,
             a.package_items, a.product_items, a.membership_items,
             TO_CHAR(a.created_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS time,
             NULL::text AS ticket_no
      FROM appointments a
    ) a
    LEFT JOIN clients c ON a.client_id = c.id
    LEFT JOIN LATERAL (
      SELECT svc.value->>'name' AS name, svc.value->>'service_id' AS item_id,
             NULLIF(svc.value->>'staff_id', '')::uuid AS staff_id,
             COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0) AS price,
             COALESCE(NULLIF(svc.value->>'quantity', '')::numeric, 1) AS quantity,
             'service' AS item_type
      FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
      UNION ALL
      SELECT pkg.value->>'name', pkg.value->>'package_id',
             NULLIF(pkg.value->>'staff_id', '')::uuid,
             COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0),
             COALESCE(NULLIF(pkg.value->>'quantity', '')::numeric, 1),
             'package'
      FROM jsonb_array_elements(COALESCE(a.package_items, '[]'::jsonb)) AS pkg(value)
      UNION ALL
      SELECT prod.value->>'name', prod.value->>'product_id',
             NULLIF(prod.value->>'staff_id', '')::uuid,
             COALESCE(NULLIF(prod.value->>'price', '')::numeric, 0),
             COALESCE(NULLIF(prod.value->>'quantity', '')::numeric, 1),
             'product'
      FROM jsonb_array_elements(COALESCE(a.product_items, '[]'::jsonb)) AS prod(value)
      UNION ALL
      SELECT mem.value->>'name', mem.value->>'membership_id',
             NULLIF(mem.value->>'staff_id', '')::uuid,
             COALESCE(NULLIF(mem.value->>'price', '')::numeric, 0),
             COALESCE(NULLIF(mem.value->>'quantity', '')::numeric, 1),
             'membership'
      FROM jsonb_array_elements(COALESCE(a.membership_items, '[]'::jsonb)) AS mem(value)
    ) src ON TRUE
    LEFT JOIN staff st ON st.id = COALESCE(src.staff_id, a.staff_id)
    LEFT JOIN LATERAL (
      SELECT
        MAX(p.payment_method) FILTER (
          WHERE p.created_at = (SELECT MAX(p2.created_at) FROM payments p2 WHERE p2.appointment_id = a.appointment_id)
        ) AS latest_method,
        -- A "partial" appointment (paid something, not yet fully checked
        -- out/invoiced) has real payments rows even with no sales row yet —
        -- same source Sales Summary's own unbilled CTE uses
        -- (_UNBILLED_APPOINTMENT_ROWS_CTE's pay.total_paid/latest_due), so
        -- this reconciles instead of always showing "$0 paid, fully due".
        COALESCE(SUM(p.paid_amount) FILTER (WHERE p.status IN ('completed', 'partial')), 0) AS total_paid,
        COALESCE(MAX(p.due_amount) FILTER (
          WHERE p.created_at = (SELECT MAX(p2.created_at) FROM payments p2 WHERE p2.appointment_id = a.appointment_id)
        ), 0) AS latest_due
      FROM payments p
      WHERE p.appointment_id = a.appointment_id
    ) pay ON TRUE
    WHERE src.name IS NOT NULL AND ${where.join(" AND ")}
  `;

  return { sql, values, nextIndex: idx };
},

async getDailySheetReport(
  salonId: string,
  filters: {
    date?: string; service_id?: string; service_ids?: string[]; staff_ids?: string[]; search?: string;
    payment_mode?: string; payment_modes?: string[];
    status?: string; statuses?: string[];
    item_type?: string; item_types?: string[];
    time_from?: string; time_to?: string;
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: DailySheetReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
  total_amount: number;
  total_paid: number;
  total_due: number;
  invoice_count: number;
  client_count: number;
  staff_count: number;
  items_count: number;
  pending_payment_count: number;
  fully_paid_count: number;
}> {
  const { where, saleItemsJoin, values, nextIndex } = this._buildDailySheetWhere(salonId, filters);
  const unbilled = this._UNBILLED_APPOINTMENT_DAILY_ROWS_CTE(filters, nextIndex);
  let idx = unbilled.nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    WITH sales_side AS (
      SELECT
        s.appointment_id,
        s.id AS sale_id,
        TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS time,
        s.invoice_number AS ticket_no,
        s.client_id,
        c.full_name AS client_name,
        si.item_id::text AS service_id,
        si.name AS service,
        si.item_type,
        st.id AS staff_id,
        NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff,
        COALESCE(si.total_price, s.total_amount) AS amount,
        -- Sale-level paid/due, exactly as Sales Summary computes it (same
        -- _PAYMENT_LATERAL fields, same branches) — NOT prorated per line
        -- item. Every line item of the same sale carries the identical
        -- invoice-level figure; the grouped CTE re-collapses to one row per
        -- invoice via MIN/MAX (a no-op on a constant), so this always
        -- reconciles exactly with Sales Summary instead of drifting from
        -- proration rounding (si.total_price / s.subtotal can be lossy).
        CASE
          WHEN s.appointment_id IS NOT NULL THEN pay.paid_from_payments
          WHEN s.status = 'completed' THEN s.total_amount::numeric
          ELSE 0
        END AS paid_amount,
        COALESCE(pay.latest_due, 0) AS due_amount,
        s.payment_method,
        s.payment_reference,
        ${this._STATUS_EXPR} AS status,
        s.created_at AS sort_at
      FROM sales s
      LEFT JOIN sale_items si ON ${saleItemsJoin}
      LEFT JOIN clients c ON s.client_id = c.id
      LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
      ${this._PAYMENT_LATERAL}
      ${this._APPOINTMENT_STATUS_JOIN}
      WHERE ${where}
    ),
    appt_side AS (
      SELECT
        u.appointment_id, u.sale_id, u.time, u.ticket_no, u.client_id, u.client_name,
        u.service_id, u.service, u.item_type, u.staff_id, u.staff, u.amount,
        -- Real payments can exist on an appointment before it's ever invoiced
        -- (a "partial" checkout) — same source as Sales Summary's own
        -- unbilled CTE (pay.total_paid/latest_due), not hardcoded to
        -- "$0 paid, fully due" like before. Appointment-level constant
        -- (same on every line item row), so grouped's MAX() is a no-op here
        -- too, same as sales_side.
        COALESCE(u.total_paid, 0) AS paid_amount,
        COALESCE(u.latest_due, 0) AS due_amount,
        u.payment_method, NULL::text AS payment_reference, u.status,
        (SELECT a2.created_at FROM appointments a2 WHERE a2.id = u.appointment_id) AS sort_at
      FROM (${unbilled.sql}) u
    ),
    unified AS (
      SELECT * FROM sales_side
      UNION ALL
      SELECT * FROM appt_side
    ),
    -- One row per invoice/appointment (not per line item) — multi-item sales
    -- (e.g. a service + a membership on the same bill) used to surface as
    -- separate rows sharing an invoice number, which read as duplicates.
    -- Items/staff are combined into one display string per invoice; amount
    -- and tax are summed back up to the invoice total.
    grouped AS (
      SELECT
        COALESCE(sale_id::text, appointment_id::text) AS group_key,
        MIN(appointment_id::text)::uuid AS appointment_id,
        MIN(sale_id::text)::uuid AS sale_id,
        MIN(time) AS time,
        MIN(ticket_no) AS ticket_no,
        MIN(client_id::text)::uuid AS client_id,
        MIN(client_name) AS client_name,
        STRING_AGG(DISTINCT service, ', ') AS service,
        STRING_AGG(DISTINCT item_type, ', ') AS item_type,
        STRING_AGG(DISTINCT staff, ', ') AS staff,
        SUM(amount) AS amount,
        -- paid/due are a constant per invoice/appointment (every line item
        -- row of the same group carries the identical value), so MAX is a
        -- no-op collapse back to one row, not a real aggregation.
        MAX(paid_amount) AS paid_amount,
        MAX(due_amount) AS due_amount,
        MIN(payment_method) AS payment_method,
        MIN(payment_reference) AS payment_reference,
        MIN(status) AS status,
        MIN(sort_at) AS sort_at
      FROM unified
      GROUP BY COALESCE(sale_id::text, appointment_id::text)
    ),
    -- COUNT(DISTINCT ...) can't be a window function in Postgres, so these
    -- distinct counts over the WHOLE filtered set are computed as a single
    -- scalar-aggregate CTE and cross-joined onto every row instead.
    aggregates AS (
      SELECT
        COUNT(DISTINCT COALESCE(sale_id::text, appointment_id::text)) AS invoice_count,
        COUNT(DISTINCT client_id) AS client_count,
        COUNT(DISTINCT staff_id) AS staff_count
      FROM unified
    )
    SELECT grouped.*,
      SUM(amount) OVER() AS total_amount_sum,
      SUM(paid_amount) OVER() AS total_paid_sum,
      SUM(due_amount) OVER() AS total_due_sum,
      COUNT(*) FILTER (WHERE due_amount > 0.01) OVER() AS pending_payment_count,
      COUNT(*) FILTER (WHERE due_amount <= 0.01) OVER() AS fully_paid_count,
      COUNT(*) OVER() AS total_count,
      aggregates.invoice_count,
      aggregates.client_count,
      aggregates.staff_count
    FROM grouped, aggregates
    ORDER BY sort_at ASC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...unbilled.values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const totalAmount = rows.length ? Number(rows[0].total_amount_sum ?? 0) : 0;
  const totalPaid = rows.length ? Number(rows[0].total_paid_sum ?? 0) : 0;
  const totalDue = rows.length ? Number(rows[0].total_due_sum ?? 0) : 0;
  const invoiceCount = rows.length ? Number(rows[0].invoice_count ?? 0) : 0;
  const clientCount = rows.length ? Number(rows[0].client_count ?? 0) : 0;
  const staffCount = rows.length ? Number(rows[0].staff_count ?? 0) : 0;
  const pendingPaymentCount = rows.length ? Number(rows[0].pending_payment_count ?? 0) : 0;
  const fullyPaidCount = rows.length ? Number(rows[0].fully_paid_count ?? 0) : 0;
  const items: DailySheetReportRow[] = rows.map((row: any) => ({
    appointment_id: row.appointment_id,
    sale_id: row.sale_id,
    time: row.time,
    ticket_no: row.ticket_no,
    client_id: row.client_id,
    client_name: row.client_name,
    // One row per invoice now (grouped from potentially several line items),
    // so a single service_id/staff_id is no longer meaningful — `service`/
    // `staff` are comma-joined display strings instead.
    service_id: null,
    service: row.service,
    item_type: row.item_type,
    staff_id: null,
    staff: row.staff,
    amount: Number(row.amount ?? 0),
    paid_amount: Number(row.paid_amount ?? 0),
    due_amount: Number(row.due_amount ?? 0),
    payment_method: row.payment_method,
    payment_reference: row.payment_reference,
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
    total_amount: totalAmount,
    total_paid: totalPaid,
    total_due: totalDue,
    invoice_count: invoiceCount,
    client_count: clientCount,
    staff_count: staffCount,
    items_count: total,
    pending_payment_count: pendingPaymentCount,
    fully_paid_count: fullyPaidCount,
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

  const { rows: paymentModeRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT payment_method
     FROM sales
     WHERE salon_id = $1 AND status <> 'draft' AND payment_method IS NOT NULL
     ORDER BY payment_method ASC`,
    [salonId]
  ));

  return {
    services: serviceRows.map((r: any) => ({ id: r.id, label: r.label })),
    staff: staffRows.map((r: any) => ({ id: r.id, label: r.label })),
    payment_modes: paymentModeRows.map((r: any) => String(r.payment_method)),
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
    staff_ids?: string[];
    brand_id?: string;
    brand_ids?: string[];
    category_id?: string;
    category_ids?: string[];
    min_price?: number;
    max_price?: number;
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
  if (filters.staff_ids && filters.staff_ids.length > 0) {
    where.push(`COALESCE(si.staff_id, s.staff_id) = ANY($${idx++}::uuid[])`);
    values.push(filters.staff_ids);
  }
  if (filters.brand_ids && filters.brand_ids.length > 0) {
    where.push(`p.brand_id = ANY($${idx++}::uuid[])`);
    values.push(filters.brand_ids);
  } else if (filters.brand_id) {
    where.push(`p.brand_id = $${idx++}`);
    values.push(filters.brand_id);
  }
  if (filters.category_ids && filters.category_ids.length > 0) {
    where.push(`p.category_id = ANY($${idx++}::uuid[])`);
    values.push(filters.category_ids);
  } else if (filters.category_id) {
    where.push(`p.category_id = $${idx++}`);
    values.push(filters.category_id);
  }
  if (filters.min_price !== undefined) {
    where.push(`si.unit_price >= $${idx++}`);
    values.push(filters.min_price);
  }
  if (filters.max_price !== undefined) {
    where.push(`si.unit_price <= $${idx++}`);
    values.push(filters.max_price);
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
  filters: {
    start_date?: string; end_date?: string; product_id?: string; search?: string;
    staff_ids?: string[]; brand_id?: string; brand_ids?: string[]; category_id?: string; category_ids?: string[]; min_price?: number; max_price?: number;
  }
): Promise<ProductRetailReportStats> {
  const { where, values } = this._buildProductRetailWhere(salonId, filters);

  const query = `
    SELECT
      COALESCE(SUM(si.quantity), 0)::int AS total_quantity,
      -- Actually collected (paid_amount), not the tax-inclusive billed
      -- amount — matches the Paid Amount column now shown on this report
      -- instead of Bill/GST. Same _PAYMENT_LATERAL proration as
      -- getProductRetailReportRows.
      COALESCE(SUM(
        CASE WHEN COALESCE(s.subtotal, 0) > 0
          THEN (CASE WHEN s.appointment_id IS NOT NULL THEN pay.paid_from_payments
                     WHEN s.status = 'completed' THEN s.total_amount::numeric
                     ELSE 0 END) * (si.total_price / s.subtotal)
          ELSE 0
        END
      ), 0) AS total_revenue,
      COUNT(DISTINCT si.item_id)::int AS unique_products,
      COUNT(*)::int AS line_items
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN clients c ON s.client_id = c.id
    LEFT JOIN products p ON p.id = si.item_id
    ${this._PAYMENT_LATERAL}
    WHERE ${where}
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  return {
    total_quantity: Number(r.total_quantity ?? 0),
    // Rounded to a whole number — SUM() over prorated paid_amount otherwise
    // leaves long floating-point tails/paise in the raw API response.
    total_revenue: Math.round(Number(r.total_revenue ?? 0)),
    unique_products: Number(r.unique_products ?? 0),
    line_items: Number(r.line_items ?? 0),
  };
},

async getProductRetailReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; product_id?: string; search?: string;
    staff_ids?: string[]; brand_id?: string; brand_ids?: string[]; category_id?: string; category_ids?: string[]; min_price?: number; max_price?: number;
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
      TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date,
      s.invoice_number AS invoice_no,
      s.client_id,
      c.full_name AS client_name,
      st.id AS staff_id,
      NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff_name,
      si.item_id AS product_id,
      si.name AS product_name,
      p.brand_id, pb.name AS brand_name,
      p.category_id, sc.name AS category_name,
      si.quantity,
      si.unit_price AS price,
      si.total_price AS total,
      si.tax_amount, si.taxable_amount,
      s.payment_method,
      s.status,
      -- Sale-level paid/due (same _PAYMENT_LATERAL source as Sales Summary/
      -- Daily Sheet), prorated across this sale's line items by price share —
      -- safe here since each row is displayed as its own distinct line item,
      -- never re-grouped/re-summed back into one invoice afterward.
      CASE
        WHEN COALESCE(s.subtotal, 0) > 0
          THEN (CASE WHEN s.appointment_id IS NOT NULL THEN pay.paid_from_payments
                     WHEN s.status = 'completed' THEN s.total_amount::numeric
                     ELSE 0 END) * (si.total_price / s.subtotal)
        ELSE 0
      END AS paid_amount,
      CASE
        WHEN COALESCE(s.subtotal, 0) > 0
          THEN COALESCE(pay.latest_due, 0) * (si.total_price / s.subtotal)
        ELSE 0
      END AS due_amount,
      COUNT(*) OVER() AS total_count
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN clients c ON s.client_id = c.id
    LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
    LEFT JOIN products p ON p.id = si.item_id
    LEFT JOIN product_brands pb ON pb.id = p.brand_id
    LEFT JOIN service_categories sc ON sc.id = p.category_id
    ${this._PAYMENT_LATERAL}
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
    staff_id: row.staff_id,
    staff_name: row.staff_name,
    product_id: row.product_id,
    product_name: row.product_name,
    brand_id: row.brand_id,
    brand_name: row.brand_name,
    category_id: row.category_id,
    category_name: row.category_name,
    quantity: Number(row.quantity ?? 0),
    price: Number(row.price ?? 0),
    total: Number(row.total ?? 0),
    tax_amount: Number(row.tax_amount ?? 0),
    taxable_amount: Number(row.taxable_amount ?? 0),
    // Rounded to a whole number — the proration division (× si.total_price /
    // s.subtotal) otherwise leaves long floating-point tails/paise.
    paid_amount: Math.round(Number(row.paid_amount ?? 0)),
    due_amount: Math.round(Number(row.due_amount ?? 0)),
    payment_method: row.payment_method,
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

// Per-product units-sold + tax-inclusive revenue, for the "Sales" column on
// the Product Inventory report. Grouped by si.item_id (the real product row),
// not by name — same tables/tax-proration logic as getProductRetailReportRows,
// just aggregated instead of returned as line items.
async getProductInventorySales(
  salonId: string,
  filters: { start_date?: string; end_date?: string }
): Promise<Record<string, { quantity: number; revenue: number }>> {
  const { where, values } = this._buildProductRetailWhere(salonId, filters);

  const query = `
    SELECT
      si.item_id AS product_id,
      SUM(si.quantity) AS quantity,
      SUM(
        si.total_price + (
          CASE WHEN COALESCE(s.subtotal, 0) > 0
               THEN COALESCE(s.tax_amount, 0) * (si.total_price / s.subtotal)
               ELSE 0
          END
        )
      ) AS revenue
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE ${where} AND si.item_id IS NOT NULL
    GROUP BY si.item_id
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const result: Record<string, { quantity: number; revenue: number }> = {};
  for (const row of rows) {
    result[String(row.product_id)] = {
      quantity: Number(row.quantity ?? 0),
      revenue: Number(row.revenue ?? 0),
    };
  }
  return result;
},

// Distinct products that have EVER been sold in this salon — scoped only to
// salon_id, not the current date/filters, so the dropdown stays complete.
// Zero separate /products API call needed on the frontend.
async getProductRetailFiltersAvailable(salonId: string): Promise<{
  products: ProductRetailFilterOption[];
  staff: ProductRetailFilterOption[];
  brands: ProductRetailFilterOption[];
  categories: ProductRetailFilterOption[];
}> {
  const { rows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT si.item_id AS id, si.name AS label
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     WHERE s.salon_id = $1 AND s.status <> 'draft' AND si.item_type = 'product' AND si.item_id IS NOT NULL
     ORDER BY si.name ASC`,
    [salonId]
  ));

  const { rows: staffRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT st.id, TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))) AS label
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
     WHERE s.salon_id = $1 AND s.status <> 'draft' AND si.item_type = 'product'
     ORDER BY label ASC`,
    [salonId]
  ));

  // LEFT (not INNER) JOINs throughout — a sold product with no brand_id/
  // category_id assigned must not silently vanish the whole row from these
  // option lists; it's just excluded by the trailing IS NOT NULL instead.
  const { rows: brandRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT pb.id, pb.name AS label
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     LEFT JOIN products p ON p.id = si.item_id
     LEFT JOIN product_brands pb ON pb.id = p.brand_id
     WHERE s.salon_id = $1 AND s.status <> 'draft' AND si.item_type = 'product' AND pb.id IS NOT NULL
     ORDER BY label ASC`,
    [salonId]
  ));

  const { rows: categoryRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT sc.id, sc.name AS label
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     LEFT JOIN products p ON p.id = si.item_id
     LEFT JOIN service_categories sc ON sc.id = p.category_id
     WHERE s.salon_id = $1 AND s.status <> 'draft' AND si.item_type = 'product' AND sc.id IS NOT NULL
     ORDER BY label ASC`,
    [salonId]
  ));

  return {
    products: rows.map((r: any) => ({ id: r.id, label: r.label })),
    staff: staffRows.map((r: any) => ({ id: r.id, label: r.label })),
    brands: brandRows.map((r: any) => ({ id: r.id, label: r.label })),
    categories: categoryRows.map((r: any) => ({ id: r.id, label: r.label })),
  };
},

// ======================================================
// SERVICE SALE REPORT (independent report API)
// POST /api/report/service-sale — reads sales/sale_items directly
// (item_type = 'service'), one row per line item. Never calls the
// Appointment API/service.
// ======================================================

_buildServiceSaleWhere(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; staff_ids?: string[]; search?: string;
    category_id?: string; category_ids?: string[];
    service_id?: string; service_ids?: string[];
    min_price?: number; max_price?: number;
    payment_method?: string; payment_methods?: string[];
  }
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
  if (filters.staff_ids && filters.staff_ids.length > 0) {
    where.push(`COALESCE(si.staff_id, s.staff_id) = ANY($${idx++}::uuid[])`);
    values.push(filters.staff_ids);
  }
  if (filters.service_ids && filters.service_ids.length > 0) {
    where.push(`si.item_id = ANY($${idx++}::uuid[])`);
    values.push(filters.service_ids);
  } else if (filters.service_id) {
    where.push(`si.item_id = $${idx++}`);
    values.push(filters.service_id);
  }
  if (filters.category_ids && filters.category_ids.length > 0) {
    where.push(`sv.category_id = ANY($${idx++}::uuid[])`);
    values.push(filters.category_ids);
  } else if (filters.category_id) {
    where.push(`sv.category_id = $${idx++}`);
    values.push(filters.category_id);
  }
  if (filters.min_price !== undefined) {
    where.push(`si.unit_price >= $${idx++}`);
    values.push(filters.min_price);
  }
  if (filters.max_price !== undefined) {
    where.push(`si.unit_price <= $${idx++}`);
    values.push(filters.max_price);
  }
  if (filters.payment_methods && filters.payment_methods.length > 0) {
    where.push(`s.payment_method = ANY($${idx++}::text[])`);
    values.push(filters.payment_methods);
  } else if (filters.payment_method) {
    where.push(`s.payment_method = $${idx++}`);
    values.push(filters.payment_method);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(s.invoice_number, '') ILIKE $${idx}
      OR COALESCE(si.name, '') ILIKE $${idx}
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
  filters: {
    start_date?: string; end_date?: string; staff_ids?: string[]; search?: string;
    category_id?: string; category_ids?: string[];
    service_id?: string; service_ids?: string[];
    min_price?: number; max_price?: number;
    payment_method?: string; payment_methods?: string[];
  }
): Promise<ServiceSaleReportStats> {
  const { where, values } = this._buildServiceSaleWhere(salonId, filters);

  const query = `
    SELECT
      COUNT(*)::int AS services_sold,
      -- Actually collected (paid_amount), not the pre-tax billed amount —
      -- matches the Paid Amount column now shown on this report instead of
      -- Bill/GST. Same _PAYMENT_LATERAL proration as getServiceSaleReportRows.
      COALESCE(SUM(
        CASE WHEN COALESCE(s.subtotal, 0) > 0
          THEN (CASE WHEN s.appointment_id IS NOT NULL THEN pay.paid_from_payments
                     WHEN s.status = 'completed' THEN s.total_amount::numeric
                     ELSE 0 END) * (si.total_price / s.subtotal)
          ELSE 0
        END
      ), 0) AS total_revenue,
      COUNT(DISTINCT si.name)::int AS unique_services
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN clients c ON s.client_id = c.id
    LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
    LEFT JOIN services sv ON sv.id = si.item_id
    ${this._PAYMENT_LATERAL}
    WHERE ${where}
  `;

  const topServiceQuery = `
    SELECT si.name AS name, COUNT(*)::int AS count
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN clients c ON s.client_id = c.id
    LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
    LEFT JOIN services sv ON sv.id = si.item_id
    WHERE ${where}
    GROUP BY si.name
    ORDER BY COUNT(*) DESC, si.name ASC
    LIMIT 1
  `;

  const [{ rows }, { rows: topRows }] = await Promise.all([
    safeQuery(() => pool.query(query, values)),
    safeQuery(() => pool.query(topServiceQuery, values)),
  ]);
  const r = rows[0] ?? {};
  const services_sold = Number(r.services_sold ?? 0);
  // Rounded to a whole number — SUM() over prorated paid_amount otherwise
  // leaves long floating-point tails/paise in the raw API response.
  const total_revenue = Math.round(Number(r.total_revenue ?? 0));
  const topRow = topRows[0];
  return {
    services_sold,
    total_revenue,
    avg_ticket: services_sold > 0 ? Math.round(total_revenue / services_sold) : 0,
    unique_services: Number(r.unique_services ?? 0),
    top_service: topRow ? { name: String(topRow.name), count: Number(topRow.count ?? 0) } : null,
  };
},

async getServiceSaleReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; staff_ids?: string[]; search?: string;
    category_id?: string; category_ids?: string[];
    service_id?: string; service_ids?: string[];
    min_price?: number; max_price?: number;
    payment_method?: string; payment_methods?: string[];
    sort_by?: "date" | "invoice_no" | "service_name" | "staff_name" | "price" | "total";
    sort_dir?: "asc" | "desc";
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

  // Total = line's own tax-inclusive price. "total" sort key matches the
  // Total column shown on the frontend (unit price + its own GST).
  const sortColumns: Record<string, string> = {
    date: "s.created_at",
    invoice_no: "s.invoice_number",
    service_name: "si.name",
    staff_name: "staff_name",
    price: "si.total_price",
    total: "(si.total_price + si.tax_amount)",
  };
  const sortColumn = sortColumns[filters.sort_by ?? "date"] ?? sortColumns.date;
  const sortDir = filters.sort_dir === "asc" ? "ASC" : "DESC";
  const orderClause = filters.sort_by
    ? `ORDER BY ${sortColumn} ${sortDir}, s.created_at DESC`
    : `ORDER BY s.created_at DESC`;

  const query = `
    SELECT
      s.id AS sale_id,
      TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date,
      s.invoice_number AS invoice_no,
      s.client_id,
      c.full_name AS client_name,
      st.id AS staff_id,
      NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff_name,
      si.item_id AS service_id,
      si.name AS service_name,
      sv.category_id, sc.name AS category_name,
      si.total_price AS price,
      si.tax_amount, si.taxable_amount,
      s.payment_method,
      s.status,
      -- Sale-level paid/due (same _PAYMENT_LATERAL source as Sales Summary/
      -- Daily Sheet), prorated across this sale's line items by price share —
      -- safe here since each row is displayed as its own distinct line item,
      -- never re-grouped/re-summed back into one invoice afterward (unlike
      -- Daily Sheet, where that re-summing is what caused proration drift).
      CASE
        WHEN COALESCE(s.subtotal, 0) > 0
          THEN (CASE WHEN s.appointment_id IS NOT NULL THEN pay.paid_from_payments
                     WHEN s.status = 'completed' THEN s.total_amount::numeric
                     ELSE 0 END) * (si.total_price / s.subtotal)
        ELSE 0
      END AS paid_amount,
      CASE
        WHEN COALESCE(s.subtotal, 0) > 0
          THEN COALESCE(pay.latest_due, 0) * (si.total_price / s.subtotal)
        ELSE 0
      END AS due_amount,
      COUNT(*) OVER() AS total_count
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN clients c ON s.client_id = c.id
    LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
    LEFT JOIN services sv ON sv.id = si.item_id
    LEFT JOIN service_categories sc ON sc.id = sv.category_id
    ${this._PAYMENT_LATERAL}
    WHERE ${where}
    ${orderClause}
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
    category_id: row.category_id,
    category_name: row.category_name,
    price: Number(row.price ?? 0),
    tax_amount: Number(row.tax_amount ?? 0),
    taxable_amount: Number(row.taxable_amount ?? 0),
    // Rounded to a whole number — the proration division (× si.total_price /
    // s.subtotal) otherwise leaves long floating-point tails/paise.
    paid_amount: Math.round(Number(row.paid_amount ?? 0)),
    due_amount: Math.round(Number(row.due_amount ?? 0)),
    payment_method: row.payment_method,
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

// Distinct staff that have EVER sold a service in this salon — scoped only
// to salon_id, not the current date/filters, so the dropdown stays complete.
async getServiceSaleFiltersAvailable(salonId: string): Promise<{
  staff: ServiceSaleFilterOption[];
}> {
  const { rows: staffRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT st.id, TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))) AS label
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
     WHERE s.salon_id = $1 AND s.status <> 'draft' AND si.item_type = 'service'
     ORDER BY label ASC`,
    [salonId]
  ));

  return {
    staff: staffRows.map((r: any) => ({ id: r.id, label: r.label })),
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
  filters: {
    start_date?: string; end_date?: string; staff_ids?: string[]; search?: string;
    // Any invoice with at least one line item of the selected type(s) —
    // matches what the report's own Service/Product/Package/Membership
    // Amount columns already break the invoice down by.
    item_types?: string[];
    payment_methods?: string[];
  }
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
  if (filters.staff_ids && filters.staff_ids.length > 0) {
    where.push(`s.staff_id = ANY($${idx++}::uuid[])`);
    values.push(filters.staff_ids);
  }
  if (filters.item_types && filters.item_types.length > 0) {
    where.push(`EXISTS (
      SELECT 1 FROM sale_items si2
      WHERE si2.sale_id = s.id AND si2.item_type = ANY($${idx++}::text[])
    )`);
    values.push(filters.item_types);
  }
  if (filters.payment_methods && filters.payment_methods.length > 0) {
    where.push(`s.payment_method = ANY($${idx++}::text[])`);
    values.push(filters.payment_methods);
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
  filters: {
    start_date?: string; end_date?: string; staff_ids?: string[]; search?: string;
    item_types?: string[]; payment_methods?: string[];
  }
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
    start_date?: string; end_date?: string; staff_ids?: string[]; search?: string;
    item_types?: string[]; payment_methods?: string[];
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
      s.appointment_id,
      TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date,
      s.invoice_number AS invoice_no,
      c.full_name AS client_name,
      COALESCE(items.service_amount, 0) AS service_amount,
      COALESCE(items.product_amount, 0) AS product_amount,
      COALESCE(items.package_amount, 0) AS package_amount,
      COALESCE(items.membership_amount, 0) AS membership_amount,
      GREATEST(s.subtotal::numeric - s.discount_amount::numeric, 0) AS taxable_amount,
      s.tax_amount::numeric AS tax_amount,
      s.total_amount::numeric AS total,
      COUNT(*) OVER() AS total_count
    FROM sales s
    LEFT JOIN clients c ON s.client_id = c.id
    LEFT JOIN LATERAL (
      SELECT
        SUM(si.taxable_amount) FILTER (WHERE si.item_type = 'service') AS service_amount,
        SUM(si.taxable_amount) FILTER (WHERE si.item_type = 'product') AS product_amount,
        SUM(si.taxable_amount) FILTER (WHERE si.item_type = 'package') AS package_amount,
        SUM(si.taxable_amount) FILTER (WHERE si.item_type = 'membership') AS membership_amount
      FROM sale_items si
      WHERE si.sale_id = s.id
    ) items ON TRUE
    WHERE ${where}
    ORDER BY s.created_at DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: GstReportRow[] = rows.map((row: any) => ({
    sale_id: row.sale_id,
    appointment_id: row.appointment_id ?? null,
    date: row.date,
    invoice_no: row.invoice_no,
    client_name: row.client_name,
    service_amount: Number(row.service_amount ?? 0),
    product_amount: Number(row.product_amount ?? 0),
    package_amount: Number(row.package_amount ?? 0),
    membership_amount: Number(row.membership_amount ?? 0),
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
  filters: {
    start_date?: string; end_date?: string; search?: string;
    brand_ids?: string[]; category_ids?: string[];
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
  if (filters.search?.trim()) {
    where.push(`si.name ILIKE $${idx++}`);
    values.push(`%${filters.search.trim()}%`);
  }
  // Brand/Category are product attributes, not sale_items columns — matched
  // via si.item_id same as the cost lookup below. A line item whose
  // product_id no longer resolves (deleted/renamed product) can't be
  // attributed to a brand/category, so it's correctly excluded when either
  // filter is active (same edge case the cost lookup's name-fallback below
  // already accepts for cost purposes only, not filtering).
  if (filters.brand_ids && filters.brand_ids.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM products p2 WHERE p2.id = si.item_id AND p2.brand_id = ANY($${idx++}::uuid[]))`);
    values.push(filters.brand_ids);
  }
  if (filters.category_ids && filters.category_ids.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM products p2 WHERE p2.id = si.item_id AND p2.category_id = ANY($${idx++}::uuid[]))`);
    values.push(filters.category_ids);
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
  filters: { start_date?: string; end_date?: string; search?: string; brand_ids?: string[]; category_ids?: string[] }
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
  filters: {
    start_date?: string; end_date?: string; search?: string; brand_ids?: string[]; category_ids?: string[];
    page?: number; limit?: number; is_export?: boolean;
  }
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
  filters: {
    search?: string; start_date?: string; end_date?: string; status?: string;
    points_available_min?: number; points_available_max?: number;
    points_redeemed_min?: number; points_redeemed_max?: number;
  }
): { clientWhere: string; ledgerWhere: string; postAggWhere: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  let idx = 2;
  const clientWhere = ["c.salon_id = $1"];
  const ledgerWhere: string[] = [];
  const postAggWhere: string[] = [];

  if (filters.search?.trim()) {
    clientWhere.push(`(
      COALESCE(c.full_name, '') ILIKE $${idx}
      OR COALESCE(c.phone_number, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }
  if (filters.start_date) {
    ledgerWhere.push(`rl.created_at >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    ledgerWhere.push(`rl.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.status === "active") {
    postAggWhere.push(`points_available > 0`);
  } else if (filters.status === "inactive") {
    postAggWhere.push(`points_available = 0`);
  }
  if (filters.points_available_min != null) {
    postAggWhere.push(`points_available >= $${idx++}`);
    values.push(filters.points_available_min);
  }
  if (filters.points_available_max != null) {
    postAggWhere.push(`points_available <= $${idx++}`);
    values.push(filters.points_available_max);
  }
  if (filters.points_redeemed_min != null) {
    postAggWhere.push(`points_redeemed >= $${idx++}`);
    values.push(filters.points_redeemed_min);
  }
  if (filters.points_redeemed_max != null) {
    postAggWhere.push(`points_redeemed <= $${idx++}`);
    values.push(filters.points_redeemed_max);
  }

  return {
    clientWhere: clientWhere.join(" AND "),
    ledgerWhere: ledgerWhere.length ? `WHERE ${ledgerWhere.join(" AND ")}` : "",
    postAggWhere: postAggWhere.length ? `WHERE ${postAggWhere.join(" AND ")}` : "",
    values,
    nextIndex: idx,
  };
},

// Shared aggregation CTE — only clients with a reward-points ledger entry
// IN THE FILTERED DATE RANGE are included (matches the old report's "only
// clients with reward-points history" scope, now date-scoped the same way
// every other date-filtered report in this app works: earned/redeemed/
// last-activity are period aggregates). points_available is deliberately
// NOT date-scoped — it's the live current balance, a snapshot rather than
// something that accrues within a window.
_REWARD_POINTS_AGG(clientWhere: string, ledgerWhere: string, postAggWhere: string): string {
  return `
    WITH ledger_agg AS (
      SELECT
        rl.client_id,
        COALESCE(SUM(rl.points) FILTER (WHERE rl.type = 'earn'), 0) AS points_earned,
        COALESCE(SUM(-rl.points) FILTER (WHERE rl.type = 'redeem'), 0) AS points_redeemed,
        MAX(rl.created_at) AS last_activity_at
      FROM reward_points_ledger rl
      ${ledgerWhere}
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
      WHERE ${clientWhere}
    ),
    filtered AS (
      SELECT * FROM reward_agg
      ${postAggWhere}
    )
  `;
},

async getRewardPointsReportStats(
  salonId: string,
  filters: {
    search?: string; start_date?: string; end_date?: string; status?: string;
    points_available_min?: number; points_available_max?: number;
    points_redeemed_min?: number; points_redeemed_max?: number;
  }
): Promise<RewardPointsReportStats> {
  const { clientWhere, ledgerWhere, postAggWhere, values } = this._buildRewardPointsWhere(salonId, filters);

  const query = `
    ${this._REWARD_POINTS_AGG(clientWhere, ledgerWhere, postAggWhere)}
    SELECT
      COALESCE(SUM(points_available), 0) AS points_available,
      COALESCE(SUM(points_earned), 0) AS total_points_earned,
      COALESCE(SUM(points_redeemed), 0) AS total_points_redeemed,
      COUNT(*)::int AS active_reward_clients
    FROM filtered
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  return {
    points_available: Number(r.points_available ?? 0),
    total_points_earned: Number(r.total_points_earned ?? 0),
    total_points_redeemed: Number(r.total_points_redeemed ?? 0),
    active_reward_clients: Number(r.active_reward_clients ?? 0),
  };
},

async getRewardPointsReportRows(
  salonId: string,
  filters: {
    search?: string; start_date?: string; end_date?: string; status?: string;
    points_available_min?: number; points_available_max?: number;
    points_redeemed_min?: number; points_redeemed_max?: number;
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: RewardPointsReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { clientWhere, ledgerWhere, postAggWhere, values, nextIndex } = this._buildRewardPointsWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    ${this._REWARD_POINTS_AGG(clientWhere, ledgerWhere, postAggWhere)}
    SELECT
      client_id, client_name, mobile, points_available, points_earned,
      points_redeemed, last_activity_at,
      COUNT(*) OVER() AS total_count
    FROM filtered
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
  filters: {
    search?: string; as_of_date?: string; status?: string;
    balance_min?: number; balance_max?: number;
  }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["c.salon_id = $1"];
  let idx = 2;

  // Wallet balance is a live running total (clients.ewallet_balance) — there's
  // no historical snapshot to reconstruct, so "as of date" only narrows which
  // clients are included (those who existed by that date), not the balance
  // value itself. No lower bound: every client registered on/before the date
  // is in scope, so existing clients never vanish just because they signed
  // up before some earlier "from" date (the previous From/To range bug).
  if (filters.as_of_date) {
    where.push(`c.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.as_of_date);
  }
  // Same has-balance/no-balance split as the stats card's with_balance count.
  if (filters.status === "with_balance") {
    where.push(`COALESCE(c.ewallet_balance, 0) > 0`);
  } else if (filters.status === "no_balance") {
    where.push(`COALESCE(c.ewallet_balance, 0) = 0`);
  }
  if (filters.balance_min != null) {
    where.push(`COALESCE(c.ewallet_balance, 0) >= $${idx++}`);
    values.push(filters.balance_min);
  }
  if (filters.balance_max != null) {
    where.push(`COALESCE(c.ewallet_balance, 0) <= $${idx++}`);
    values.push(filters.balance_max);
  }
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
  filters: { search?: string; as_of_date?: string; status?: string; balance_min?: number; balance_max?: number }
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
  filters: {
    search?: string; as_of_date?: string; status?: string;
    balance_min?: number; balance_max?: number;
    page?: number; limit?: number; is_export?: boolean;
  }
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
// PRODUCT INVENTORY REPORT (independent report API)
// POST /api/report/product-inventory — reads products directly (brand/
// category joined by name), one row per product. Never calls the
// Appointment API/service.
// ======================================================

_buildProductInventoryWhere(
  salonId: string,
  filters: {
    search?: string; category_id?: string; brand_id?: string;
    stock_status?: "in_stock" | "low_stock" | "out_of_stock";
    date_from?: string; date_to?: string;
  }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["p.salon_id = $1"];
  let idx = 2;

  if (filters.search?.trim()) {
    where.push(`(
      p.name ILIKE $${idx}
      OR COALESCE(p.barcode, '') ILIKE $${idx}
      OR EXISTS (SELECT 1 FROM product_brands pb_search WHERE pb_search.id = p.brand_id AND pb_search.name ILIKE $${idx})
      OR EXISTS (SELECT 1 FROM service_categories sc_search WHERE sc_search.id = p.category_id AND sc_search.name ILIKE $${idx})
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }
  if (filters.category_id) {
    where.push(`p.category_id = $${idx++}`);
    values.push(filters.category_id);
  }
  if (filters.brand_id) {
    where.push(`p.brand_id = $${idx++}`);
    values.push(filters.brand_id);
  }
  if (filters.stock_status === "low_stock") {
    where.push(`(p.amount > 0 AND p.amount <= p.qty_alert)`);
  } else if (filters.stock_status === "out_of_stock") {
    where.push(`p.amount = 0`);
  } else if (filters.stock_status === "in_stock") {
    where.push(`p.amount > p.qty_alert`);
  }
  if (filters.date_from) {
    where.push(`p.created_at >= $${idx++}::date`);
    values.push(filters.date_from);
  }
  if (filters.date_to) {
    where.push(`p.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.date_to);
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

async getProductInventoryReportStats(
  salonId: string,
  filters: {
    search?: string; category_id?: string; brand_id?: string;
    stock_status?: "in_stock" | "low_stock" | "out_of_stock";
    date_from?: string; date_to?: string;
  }
): Promise<ProductInventoryReportStats> {
  const { where, values } = this._buildProductInventoryWhere(salonId, filters);

  const query = `
    SELECT
      COUNT(*)::int AS total_products,
      COALESCE(SUM(p.amount * COALESCE(NULLIF(p.supply_price, 0), p.retail_price, 0)), 0) AS total_stock_value,
      COUNT(*) FILTER (WHERE p.amount > 0 AND p.amount <= p.qty_alert)::int AS low_stock_items,
      COUNT(*) FILTER (WHERE p.amount = 0)::int AS out_of_stock_items
    FROM products p
    WHERE ${where}
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  return {
    total_products: Number(r.total_products ?? 0),
    total_stock_value: Number(r.total_stock_value ?? 0),
    low_stock_items: Number(r.low_stock_items ?? 0),
    out_of_stock_items: Number(r.out_of_stock_items ?? 0),
  };
},

async getProductInventoryReportRows(
  salonId: string,
  filters: {
    search?: string; category_id?: string; brand_id?: string;
    stock_status?: "in_stock" | "low_stock" | "out_of_stock";
    date_from?: string; date_to?: string;
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: ProductInventoryReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildProductInventoryWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  // "Sales" reuses the exact same per-product units-sold + tax-inclusive
  // revenue aggregate already computed for the standalone
  // /product-inventory-sales endpoint, so the two stay consistent.
  const query = `
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      COALESCE(sc.name, '—') AS category_name,
      COALESCE(pb.name, '—') AS brand_name,
      COALESCE(p.barcode, '—') AS sku,
      p.created_at AS date_added,
      COALESCE(p.amount, 0) AS current_stock,
      COALESCE(p.qty_alert, 0) AS reorder_level,
      COALESCE(NULLIF(p.supply_price, 0), p.retail_price, 0) AS unit_cost,
      COALESCE(p.amount, 0) * COALESCE(NULLIF(p.supply_price, 0), p.retail_price, 0) AS total_value,
      COALESCE(sales_agg.quantity, 0) AS sales_qty,
      COALESCE(sales_agg.revenue, 0) AS sales_revenue,
      CASE
        WHEN COALESCE(p.amount, 0) = 0 THEN 'out_of_stock'
        WHEN p.amount <= p.qty_alert THEN 'low_stock'
        ELSE 'in_stock'
      END AS status,
      COUNT(*) OVER() AS total_count
    FROM products p
    LEFT JOIN product_brands pb ON p.brand_id = pb.id
    LEFT JOIN service_categories sc ON p.category_id = sc.id
    LEFT JOIN (
      SELECT
        si.item_id AS product_id,
        SUM(si.quantity) AS quantity,
        SUM(
          si.total_price + (
            CASE WHEN COALESCE(s.subtotal, 0) > 0
                 THEN COALESCE(s.tax_amount, 0) * (si.total_price / s.subtotal)
                 ELSE 0
            END
          )
        ) AS revenue
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.salon_id = $1 AND s.status <> 'draft' AND si.item_type = 'product' AND si.item_id IS NOT NULL
      GROUP BY si.item_id
    ) sales_agg ON sales_agg.product_id = p.id
    WHERE ${where}
    ORDER BY p.created_at DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: ProductInventoryReportRow[] = rows.map((row: any) => ({
    product_id: row.product_id,
    product_name: row.product_name,
    category_name: row.category_name,
    brand_name: row.brand_name,
    sku: row.sku,
    date_added: row.date_added,
    current_stock: Number(row.current_stock ?? 0),
    reorder_level: Number(row.reorder_level ?? 0),
    unit_cost: Number(row.unit_cost ?? 0),
    total_value: Number(row.total_value ?? 0),
    sales_qty: Number(row.sales_qty ?? 0),
    sales_revenue: Number(row.sales_revenue ?? 0),
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
// CLIENT REVENUE REPORT (independent report API)
// POST /api/report/client-revenue — reads sales/clients directly, grouped
// per client (by client_id when known, else name+phone for walk-ins), one
// row per client. Only status = 'completed' sales count. Never calls the
// Appointment API/service.
// ======================================================

// Client-driven: every registered client must appear (even with zero sales),
// so filters that only make sense against a sale (date range, "completed"
// status) belong in the LEFT JOIN's ON clause, not WHERE — a WHERE on s.*
// would silently discard NULL-sale rows and turn this back into an INNER
// JOIN, which is the exact bug being fixed here.
_buildClientRevenueWhere(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string;
    staff_ids?: string[]; gender?: string; membership_status?: string;
  }
): { where: string; saleJoin: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["c.salon_id = $1"];
  const saleJoin = ["s.client_id = c.id", "s.status = 'completed'"];
  let idx = 2;

  if (filters.start_date) {
    saleJoin.push(`s.created_at >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    saleJoin.push(`s.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.staff_ids && filters.staff_ids.length > 0) {
    // Matches if ANY line item's resolved staff (its own staff_id, falling
    // back to the sale's) is one of the picked staff — same convention used
    // by the staff-sales report's staff_ids filter.
    saleJoin.push(`EXISTS (
      SELECT 1 FROM sale_items si2
      WHERE si2.sale_id = s.id AND COALESCE(si2.staff_id, s.staff_id) = ANY($${idx++}::uuid[])
    )`);
    values.push(filters.staff_ids);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(c.full_name, '') ILIKE $${idx}
      OR COALESCE(c.phone_number, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }
  if (filters.gender && filters.gender !== "all") {
    where.push(`LOWER(c.gender) = $${idx++}`);
    values.push(filters.gender.toLowerCase());
  }
  if (filters.membership_status === "member") {
    where.push(`EXISTS (
      SELECT 1 FROM client_memberships cm
      WHERE cm.client_id = c.id AND cm.salon_id = c.salon_id AND cm.status = 'active'
    )`);
  } else if (filters.membership_status === "non_member") {
    where.push(`NOT EXISTS (
      SELECT 1 FROM client_memberships cm
      WHERE cm.client_id = c.id AND cm.salon_id = c.salon_id AND cm.status = 'active'
    )`);
  }

  return { where: where.join(" AND "), saleJoin: saleJoin.join(" AND "), values, nextIndex: idx };
},

// Shared aggregation CTE — one row per registered client (LEFT JOIN sales,
// so a client with zero completed sales in the filtered range still shows
// up, with visits/total_spend/last_visit all zero/null rather than the
// client vanishing from the report entirely). `having` applies the optional
// "last visit" date-range filter, which must run per-client on the
// aggregated MAX(created_at), so it can't live in the WHERE/saleJoin.
_CLIENT_REVENUE_AGG(where: string, saleJoin: string, having: string): string {
  return `
    WITH review_stats AS (
      SELECT
        client_id,
        ROUND(AVG(rating), 1) AS avg_rating,
        COUNT(*)::int AS review_count
      FROM reviews
      WHERE salon_id = $1 AND is_visible = true
      GROUP BY client_id
    ),
    revenue_agg AS (
      SELECT
        c.id AS client_id,
        COALESCE(NULLIF(TRIM(c.full_name), ''), 'Walk-in') AS client_name,
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(c.phone_country_code, ''), ' ', COALESCE(c.phone_number, ''))), ''), '—') AS contact,
        COUNT(s.id) AS visits,
        COALESCE(SUM(s.total_amount::numeric), 0) AS total_spend,
        MAX(TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')) AS last_visit,
        rs.avg_rating,
        COALESCE(rs.review_count, 0) AS review_count
      FROM clients c
      LEFT JOIN sales s ON ${saleJoin}
      LEFT JOIN review_stats rs ON rs.client_id = c.id
      WHERE ${where}
      GROUP BY c.id, c.full_name, c.phone_number, c.phone_country_code, rs.avg_rating, rs.review_count
      ${having}
    )
  `;
},

// "Last visit" is a separate date range from the report's main start/end
// date filter — it narrows to clients whose most recent completed sale
// (already aggregated as MAX(created_at) above) falls in this window, so it
// must be a HAVING clause against the aggregate, not a per-row WHERE.
_buildClientRevenueHaving(
  filters: { last_visit_from?: string; last_visit_to?: string },
  startIdx: number
): { having: string; values: any[]; nextIndex: number } {
  const clauses: string[] = [];
  const values: any[] = [];
  let idx = startIdx;

  if (filters.last_visit_from) {
    clauses.push(`MAX(s.created_at) >= $${idx++}::date`);
    values.push(filters.last_visit_from);
  }
  if (filters.last_visit_to) {
    clauses.push(`MAX(s.created_at) < ($${idx++}::date + interval '1 day')`);
    values.push(filters.last_visit_to);
  }

  return { having: clauses.length ? `HAVING ${clauses.join(" AND ")}` : "", values, nextIndex: idx };
},

async getClientRevenueReportStats(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string;
    staff_ids?: string[]; gender?: string; membership_status?: string;
    last_visit_from?: string; last_visit_to?: string;
  }
): Promise<ClientRevenueReportStats> {
  const { where, saleJoin, values, nextIndex } = this._buildClientRevenueWhere(salonId, filters);
  const { having, values: havingValues } = this._buildClientRevenueHaving(filters, nextIndex);
  const allValues = [...values, ...havingValues];

  const query = `
    ${this._CLIENT_REVENUE_AGG(where, saleJoin, having)}
    SELECT
      COUNT(*)::int AS total_clients,
      COALESCE(SUM(total_spend), 0) AS total_revenue,
      (SELECT client_name FROM revenue_agg WHERE total_spend > 0 ORDER BY total_spend DESC LIMIT 1) AS top_client
    FROM revenue_agg
  `;

  const { rows } = await safeQuery(() => pool.query(query, allValues));
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
    staff_ids?: string[]; gender?: string; membership_status?: string;
    last_visit_from?: string; last_visit_to?: string;
    sort_by?: string; sort_dir?: "asc" | "desc";
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: ClientRevenueReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, saleJoin, values, nextIndex } = this._buildClientRevenueWhere(salonId, filters);
  const { having, values: havingValues, nextIndex: afterHavingIdx } = this._buildClientRevenueHaving(filters, nextIndex);
  let idx = afterHavingIdx;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const sortColumns: Record<string, string> = {
    total_spend: "total_spend",
    visits: "visits",
    avg_ticket: "(CASE WHEN visits > 0 THEN total_spend::numeric / visits ELSE 0 END)",
    last_visit: "last_visit",
    client_name: "client_name",
  };
  const sortColumn = sortColumns[filters.sort_by ?? "last_visit"] ?? sortColumns.last_visit;
  const sortDir = filters.sort_dir === "asc" ? "ASC" : "DESC";
  const orderClause = filters.sort_by === "client_name"
    ? `ORDER BY client_name ${sortDir}`
    : `ORDER BY ${sortColumn} ${sortDir} NULLS LAST, client_name ASC`;

  const query = `
    ${this._CLIENT_REVENUE_AGG(where, saleJoin, having)}
    SELECT
      client_id, client_name, contact, visits, total_spend, last_visit, avg_rating, review_count,
      COUNT(*) OVER() AS total_count
    FROM revenue_agg
    ${orderClause}
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...havingValues, ...limitValues]));
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
      avg_rating: row.avg_rating !== null && row.avg_rating !== undefined ? Number(row.avg_rating) : null,
      review_count: Number(row.review_count ?? 0),
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
// CUSTOMER FREQUENCY REPORT (independent report API)
// POST /api/report/customer-frequency — reads clients/sales directly, never
// the Appointment API. One row per registered client (LEFT JOIN sales, same
// convention as _CLIENT_REVENUE_AGG, so a client with zero completed sales
// still shows up instead of vanishing from the report).
// ======================================================

_buildCustomerFrequencyWhere(
  salonId: string,
  filters: { search?: string; staff_ids?: string[] }
): { where: string; saleJoin: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["c.salon_id = $1"];
  const saleJoin = ["s.client_id = c.id", "s.status = 'completed'"];
  let idx = 2;

  if (filters.staff_ids && filters.staff_ids.length > 0) {
    saleJoin.push(`EXISTS (
      SELECT 1 FROM sale_items si2
      WHERE si2.sale_id = s.id AND COALESCE(si2.staff_id, s.staff_id) = ANY($${idx++}::uuid[])
    )`);
    values.push(filters.staff_ids);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(c.full_name, '') ILIKE $${idx}
      OR COALESCE(c.phone_number, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), saleJoin: saleJoin.join(" AND "), values, nextIndex: idx };
},

// Shared aggregation CTE — one row per registered client, with first/last
// completed-sale timestamps and a visitor_type/customer_type derived from
// them. `startDateIdx`/`endDateIdx` are the bound params for the report's
// date-range filter (the window "New" is evaluated against); LOST_DAYS is a
// fixed 90-day-since-last-visit cutoff, independent of that range, per the
// same convention _buildClientRevenueHaving uses for "last visit" being a
// separate knob from the main date filter.
_CUSTOMER_FREQUENCY_AGG(where: string, saleJoin: string, startDateIdx: number | null, endDateIdx: number | null): string {
  // A client with no completed sale at all has first_visit/last_visit both
  // NULL — such a client can never be "new" (no visit to be new about) and
  // is bucketed as 'old' rather than 'lost' (never visited isn't the same
  // as "used to visit, stopped").
  const newExpr = startDateIdx
    ? `first_visit IS NOT NULL AND first_visit >= $${startDateIdx}::date${endDateIdx ? ` AND first_visit < ($${endDateIdx}::date + interval '1 day')` : ""}`
    : `first_visit IS NOT NULL AND first_visit >= (CURRENT_DATE - INTERVAL '30 days')`;

  return `
    WITH revenue_agg AS (
      SELECT
        c.id AS client_id,
        COALESCE(NULLIF(TRIM(c.full_name), ''), 'Walk-in') AS client_name,
        COALESCE(NULLIF(TRIM(CONCAT(COALESCE(c.phone_country_code, ''), ' ', COALESCE(c.phone_number, ''))), ''), '—') AS contact,
        COUNT(s.id) AS visits,
        COALESCE(SUM(s.total_amount::numeric), 0) AS total_spend,
        MIN(s.created_at AT TIME ZONE 'Asia/Kolkata') AS first_visit_ts,
        MAX(s.created_at AT TIME ZONE 'Asia/Kolkata') AS last_visit_ts,
        MIN(TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD'))::date AS first_visit,
        MAX(TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD'))::date AS last_visit
      FROM clients c
      LEFT JOIN sales s ON ${saleJoin}
      WHERE ${where}
      GROUP BY c.id, c.full_name, c.phone_number, c.phone_country_code
    ),
    segmented AS (
      SELECT *,
        CASE WHEN ${newExpr} THEN 'new' ELSE 'returning' END AS visitor_type,
        CASE
          WHEN first_visit IS NULL THEN 'old'
          WHEN ${newExpr} THEN 'new'
          WHEN last_visit < (CURRENT_DATE - INTERVAL '90 days') THEN 'lost'
          ELSE 'old'
        END AS customer_type
      FROM revenue_agg
    )
  `;
},

async getCustomerFrequencyReportStats(
  salonId: string,
  filters: { start_date?: string; end_date?: string; search?: string; staff_ids?: string[] }
): Promise<CustomerFrequencyReportStats> {
  const { where, saleJoin, values, nextIndex } = this._buildCustomerFrequencyWhere(salonId, filters);
  const dateValues: any[] = [];
  let startDateIdx: number | null = null;
  let endDateIdx: number | null = null;
  let idx = nextIndex;
  if (filters.start_date) {
    startDateIdx = idx++;
    dateValues.push(filters.start_date);
  }
  if (filters.end_date) {
    endDateIdx = idx++;
    dateValues.push(filters.end_date);
  }

  const query = `
    ${this._CUSTOMER_FREQUENCY_AGG(where, saleJoin, startDateIdx, endDateIdx)}
    SELECT
      COUNT(*)::int AS total_clients,
      COUNT(*) FILTER (WHERE visitor_type = 'new')::int AS new_clients,
      COUNT(*) FILTER (WHERE visitor_type = 'returning')::int AS returning_clients,
      COUNT(*) FILTER (WHERE customer_type = 'lost')::int AS lost_clients
    FROM segmented
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...dateValues]));
  const r = rows[0] ?? {};
  return {
    total_clients: Number(r.total_clients ?? 0),
    new_clients: Number(r.new_clients ?? 0),
    returning_clients: Number(r.returning_clients ?? 0),
    lost_clients: Number(r.lost_clients ?? 0),
  };
},

async getCustomerFrequencyReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string; staff_ids?: string[];
    customer_type?: "most_frequent" | "least_frequent" | "most_spending" | "least_spending" | "new" | "old" | "lost";
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: CustomerFrequencyReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, saleJoin, values, nextIndex } = this._buildCustomerFrequencyWhere(salonId, filters);
  const dateValues: any[] = [];
  let startDateIdx: number | null = null;
  let endDateIdx: number | null = null;
  let idx = nextIndex;
  if (filters.start_date) {
    startDateIdx = idx++;
    dateValues.push(filters.start_date);
  }
  if (filters.end_date) {
    endDateIdx = idx++;
    dateValues.push(filters.end_date);
  }

  // 'most_frequent'/'least_frequent' and 'most_spending'/'least_spending'
  // are a sort, not a bucket filter (see CustomerFrequencyReportFilters) —
  // they only change ORDER BY. 'new'/'old'/'lost' filter to that
  // customer_type segment instead.
  const segmentFilter = ["new", "old", "lost"].includes(filters.customer_type ?? "")
    ? `WHERE customer_type = $${idx}`
    : "";
  const segmentValues: any[] = segmentFilter ? [filters.customer_type] : [];
  if (segmentFilter) idx++;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const orderClause = filters.customer_type === "least_frequent"
    ? "ORDER BY visits ASC, client_name ASC"
    : filters.customer_type === "most_frequent"
    ? "ORDER BY visits DESC, client_name ASC"
    : filters.customer_type === "least_spending"
    ? "ORDER BY total_spend ASC, client_name ASC"
    : filters.customer_type === "most_spending"
    ? "ORDER BY total_spend DESC, client_name ASC"
    : "ORDER BY last_visit DESC NULLS LAST, client_name ASC";

  const query = `
    ${this._CUSTOMER_FREQUENCY_AGG(where, saleJoin, startDateIdx, endDateIdx)}
    SELECT
      client_id, client_name, contact, visits, total_spend,
      first_visit, last_visit, visitor_type, customer_type,
      COUNT(*) OVER() AS total_count
    FROM segmented
    ${segmentFilter}
    ${orderClause}
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...dateValues, ...segmentValues, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: CustomerFrequencyReportRow[] = rows.map((row: any) => ({
    client_id: row.client_id,
    client_name: row.client_name,
    contact: row.contact,
    visits: Number(row.visits ?? 0),
    total_spend: Math.round(Number(row.total_spend ?? 0)),
    first_visit: row.first_visit,
    last_visit: row.last_visit,
    visitor_type: row.visitor_type,
    customer_type: row.customer_type,
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
// STAFF SALES REPORT (independent report API)
// POST /api/report/staff-sales — reads sale_items/sales directly, bucketed
// by period (daily/weekly/monthly/yearly) and optionally filtered to one
// staff member. Never calls the Appointment API/service.
// ======================================================

// Aggregate totals over the WHOLE filtered set (not just the current page) —
// same sales_side/appt_side shape as getStaffSalesReport below, minus the
// per-row fields not needed for a sum.
async getStaffSalesReportStats(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; staff_id?: string; staff_ids?: string[]; search?: string;
    payment_mode?: string; payment_modes?: string[];
    item_type?: string; item_types?: string[];
    payment_status?: string; payment_statuses?: string[];
  }
): Promise<StaffSalesReportStats> {
  const { where, values, nextIndex } = this._buildSalesSummaryWhere(salonId, filters);
  const unbilled = this._UNBILLED_APPOINTMENT_ROWS_CTE(filters, nextIndex);

  const query = `
    WITH sales_side AS (
      SELECT
        s.total_amount::numeric AS price,
        CASE
          WHEN s.appointment_id IS NOT NULL THEN pay.paid_from_payments
          WHEN s.status = 'completed' THEN s.total_amount::numeric
          ELSE 0
        END AS paid_amount,
        COALESCE(pay.latest_due, 0) AS due_amount,
        COALESCE(comm.commission_amount, 0) AS commission_amount,
        COALESCE(itype.service_revenue, 0) AS service_revenue,
        COALESCE(itype.product_revenue, 0) AS product_revenue,
        COALESCE(itype.package_revenue, 0) AS package_revenue,
        COALESCE(itype.membership_revenue, 0) AS membership_revenue
      FROM sales s
      LEFT JOIN clients c ON s.client_id = c.id
      ${this._APPOINTMENT_STATUS_JOIN}
      ${this._PAYMENT_LATERAL}
      LEFT JOIN LATERAL (
        SELECT SUM(ce.commission_amount) AS commission_amount
        FROM commission_earned ce
        WHERE ce.sale_id = s.id
          AND ce.staff_id = COALESCE(
            s.staff_id,
            (SELECT si.staff_id FROM sale_items si WHERE si.sale_id = s.id AND si.staff_id IS NOT NULL LIMIT 1)
          )
      ) comm ON TRUE
      -- Item-type revenue breakdown — sales only (not unbilled appointments,
      -- see appt_side's zeroed columns below). Tax-inclusive (total_price +
      -- tax_amount) so these four cards sum to the tax-inclusive total_sale
      -- above instead of silently excluding GST.
      LEFT JOIN LATERAL (
        SELECT
          SUM(si.total_price + COALESCE(si.tax_amount, 0)) FILTER (WHERE si.item_type = 'service') AS service_revenue,
          SUM(si.total_price + COALESCE(si.tax_amount, 0)) FILTER (WHERE si.item_type = 'product') AS product_revenue,
          SUM(si.total_price + COALESCE(si.tax_amount, 0)) FILTER (WHERE si.item_type = 'package') AS package_revenue,
          SUM(si.total_price + COALESCE(si.tax_amount, 0)) FILTER (WHERE si.item_type = 'membership') AS membership_revenue
        FROM sale_items si
        WHERE si.sale_id = s.id
      ) itype ON TRUE
      WHERE ${where}
    ),
    appt_side AS (
      SELECT
        u.price, u.paid_amount, u.due_amount, 0::numeric AS commission_amount,
        0::numeric AS service_revenue, 0::numeric AS product_revenue,
        0::numeric AS package_revenue, 0::numeric AS membership_revenue
      FROM (${unbilled.sql}) u
    ),
    unified AS (
      SELECT * FROM sales_side
      UNION ALL
      SELECT * FROM appt_side
    )
    SELECT
      COUNT(*)::int AS total_bill,
      COALESCE(SUM(price), 0) AS total_sale,
      COALESCE(SUM(paid_amount), 0) AS total_paid,
      COALESCE(SUM(due_amount), 0) AS total_due,
      COALESCE(SUM(commission_amount), 0) AS total_commission,
      COALESCE(SUM(service_revenue), 0) AS service_revenue,
      COALESCE(SUM(product_revenue), 0) AS product_revenue,
      COALESCE(SUM(package_revenue), 0) AS package_revenue,
      COALESCE(SUM(membership_revenue), 0) AS membership_revenue
    FROM unified
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...unbilled.values]));
  const r = rows[0] ?? {};
  return {
    total_bill: Number(r.total_bill ?? 0),
    total_sale: Number(r.total_sale ?? 0),
    total_paid: Number(r.total_paid ?? 0),
    total_due: Number(r.total_due ?? 0),
    total_commission: Number(r.total_commission ?? 0),
    service_revenue: Number(r.service_revenue ?? 0),
    product_revenue: Number(r.product_revenue ?? 0),
    package_revenue: Number(r.package_revenue ?? 0),
    membership_revenue: Number(r.membership_revenue ?? 0),
  };
},

// One row per transaction (sale), scoped to whichever staff member the sale
// (or its line items) is attributed to. Reuses the same sales_side/appt_side
// UNION ALL shape as getSalesSummaryReportRows (same helpers: _buildSalesSummaryWhere,
// _UNBILLED_APPOINTMENT_ROWS_CTE, _PAYMENT_LATERAL, _APPOINTMENT_STATUS_JOIN,
// _STATUS_EXPR) so filters/behavior stay consistent with Sales Summary, plus
// a commission_amount column joined from commission_earned (keyed by
// sale_id + staff_id — unbilled appointments have no sale yet, so their
// commission is always 0, matching the fact that commission_earned rows are
// only ever written once a sale exists).
async getStaffSalesReport(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; staff_id?: string; staff_ids?: string[];
    search?: string; page?: number; limit?: number; is_export?: boolean;
    payment_mode?: string; payment_modes?: string[];
    item_type?: string; item_types?: string[];
    payment_status?: string; payment_statuses?: string[];
    // 'sales_desc'/'sales_asc' = "Most/Least Staff Sales" (each row's own
    // Total Sales amount) — default is newest-first, matching prior behavior.
    sort?: "sales_desc" | "sales_asc";
  }
): Promise<{ items: StaffSalesReportRow[]; pagination: { total: number; page: number; limit: number; total_pages: number } }> {
  const { where, values, nextIndex } = this._buildSalesSummaryWhere(salonId, filters);
  const unbilled = this._UNBILLED_APPOINTMENT_ROWS_CTE(filters, nextIndex);
  let idx = unbilled.nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];
  const orderClause = filters.sort === "sales_desc" ? "ORDER BY price DESC, created_at DESC"
    : filters.sort === "sales_asc" ? "ORDER BY price ASC, created_at DESC"
    : "ORDER BY created_at DESC";

  const query = `
    WITH sales_side AS (
      SELECT
        s.id, s.created_at,
        ${this._STATUS_EXPR} AS status,
        s.payment_method,
        s.total_amount AS price,
        c.full_name AS client_name, c.phone_number AS client_phone,
        st.id AS staff_id,
        NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff_name,
        COALESCE(items.item_description, '—') AS item_description,
        COALESCE(items.item_types, '—') AS item_types,
        CASE
          WHEN s.appointment_id IS NOT NULL THEN pay.paid_from_payments
          WHEN s.status = 'completed' THEN s.total_amount::numeric
          ELSE 0
        END AS paid_amount,
        COALESCE(pay.latest_due, 0) AS due_amount,
        COALESCE(comm.commission_amount, 0) AS commission_amount,
        COALESCE(NULLIF(items.staff_count, 0), 1) AS staff_count,
        FALSE AS is_unbilled
      FROM sales s
      LEFT JOIN clients c ON s.client_id = c.id
      LEFT JOIN staff st ON st.id = COALESCE(
        s.staff_id,
        (SELECT si.staff_id FROM sale_items si WHERE si.sale_id = s.id AND si.staff_id IS NOT NULL LIMIT 1)
      )
      ${this._PAYMENT_LATERAL}
      ${this._APPOINTMENT_STATUS_JOIN}
      LEFT JOIN LATERAL (
        SELECT
          STRING_AGG(DISTINCT si.name, ', ') AS item_description,
          STRING_AGG(DISTINCT si.item_type, ', ') AS item_types,
          -- Distinct staff attributed across this sale's line items (falling
          -- back to the sale's own staff_id per item, same convention as the
          -- staff_name join above) — >1 means this sale involved multiple
          -- staff, which staff_name alone (just the first one found) hides.
          COUNT(DISTINCT COALESCE(si.staff_id, s.staff_id)) AS staff_count
        FROM sale_items si
        WHERE si.sale_id = s.id
      ) items ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(ce.commission_amount) AS commission_amount
        FROM commission_earned ce
        WHERE ce.sale_id = s.id
          AND ce.staff_id = COALESCE(
            s.staff_id,
            (SELECT si.staff_id FROM sale_items si WHERE si.sale_id = s.id AND si.staff_id IS NOT NULL LIMIT 1)
          )
      ) comm ON TRUE
      WHERE ${where}
    ),
    appt_side AS (
      SELECT
        u.id, u.created_at, u.status, u.payment_method, u.price,
        u.client_name, u.client_phone, u.staff_id, u.staff_name,
        u.item_description, u.item_types,
        u.paid_amount, u.due_amount,
        0::numeric AS commission_amount,
        -- Unbilled appointments carry one staff_id for the whole appointment
        -- (no per-item assignment yet) — never a multi-staff sale.
        1::bigint AS staff_count,
        TRUE AS is_unbilled
      FROM (${unbilled.sql}) u
    ),
    unified AS (
      SELECT * FROM sales_side
      UNION ALL
      SELECT * FROM appt_side
    )
    SELECT *, COUNT(*) OVER() AS total_count
    FROM unified
    ${orderClause}
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...unbilled.values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: StaffSalesReportRow[] = rows.map((row: any) => ({
    id: row.id,
    staff_id: row.staff_id ?? null,
    staff_name: row.staff_name ?? "—",
    staff_count: Number(row.staff_count ?? 1),
    is_unbilled: Boolean(row.is_unbilled),
    client_name: row.client_name ?? "Walk-in",
    client_phone: row.client_phone ?? "—",
    item_types: row.item_types ?? "—",
    item_description: row.item_description ?? "—",
    price: Number(row.price ?? 0),
    paid_amount: Number(row.paid_amount ?? 0),
    due_amount: Number(row.due_amount ?? 0),
    commission_amount: Number(row.commission_amount ?? 0),
    payment_method: row.payment_method,
    status: row.status,
    created_at: row.created_at,
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
// STAFF PERFORMANCE REPORT (independent report API)
// POST /api/report/staff-performance — reads sales/sale_items directly, one
// row per staff member (never one row per invoice/item like Staff Sales).
// Deliberately real invoices only — no unbilled-appointment synthesis like
// Sales Summary/Staff Sales use, matching this report's own spec (it's a
// closed-book performance summary, not a live pipeline view). Must never
// call the Appointment API/service.
// ======================================================

_buildStaffPerformanceWhere(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; staff_ids?: string[]; branch_id?: string;
    payment_mode?: string; payment_modes?: string[];
    payment_status?: string; payment_statuses?: string[];
    item_type?: string; item_types?: string[];
    service_id?: string; product_id?: string;
    package_id?: string; package_ids?: string[];
    membership_id?: string; membership_ids?: string[];
    search?: string;
  }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["s.salon_id = $1", "s.status <> 'draft'"];
  let idx = 2;

  if (filters.start_date) {
    where.push(`s.created_at >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    where.push(`s.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.payment_statuses && filters.payment_statuses.length > 0) {
    where.push(`s.status = ANY($${idx++}::text[])`);
    values.push(filters.payment_statuses);
  } else if (filters.payment_status) {
    where.push(`s.status = $${idx++}`);
    values.push(filters.payment_status);
  }
  if (filters.payment_modes && filters.payment_modes.length > 0) {
    where.push(`s.payment_method = ANY($${idx++}::text[])`);
    values.push(filters.payment_modes);
  } else if (filters.payment_mode) {
    where.push(`s.payment_method = $${idx++}`);
    values.push(filters.payment_mode);
  }
  if (filters.staff_ids && filters.staff_ids.length > 0) {
    // Matches if ANY line item's resolved staff (its own staff_id, falling
    // back to the sale's) is one of the picked staff — same COALESCE
    // convention as every other per-item staff resolution in this file.
    where.push(`EXISTS (
      SELECT 1 FROM sale_items si2
      WHERE si2.sale_id = s.id AND COALESCE(si2.staff_id, s.staff_id) = ANY($${idx++}::uuid[])
    )`);
    values.push(filters.staff_ids);
  }
  if (filters.branch_id) {
    where.push(`COALESCE(
      s.staff_id,
      (SELECT si.staff_id FROM sale_items si WHERE si.sale_id = s.id AND si.staff_id IS NOT NULL LIMIT 1)
    ) IN (SELECT id FROM staff WHERE branch_id = $${idx++})`);
    values.push(filters.branch_id);
  }
  if (filters.item_types && filters.item_types.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.item_type = ANY($${idx++}::text[]))`);
    values.push(filters.item_types);
  } else if (filters.item_type) {
    where.push(`EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.item_type = $${idx++})`);
    values.push(filters.item_type);
  }
  if (filters.service_id) {
    where.push(`EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.item_type = 'service' AND si.item_id = $${idx++})`);
    values.push(filters.service_id);
  }
  if (filters.product_id) {
    where.push(`EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.item_type = 'product' AND si.item_id = $${idx++})`);
    values.push(filters.product_id);
  }
  if (filters.package_ids && filters.package_ids.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.item_type = 'package' AND si.item_id = ANY($${idx++}::uuid[]))`);
    values.push(filters.package_ids);
  } else if (filters.package_id) {
    where.push(`EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.item_type = 'package' AND si.item_id = $${idx++})`);
    values.push(filters.package_id);
  }
  if (filters.membership_ids && filters.membership_ids.length > 0) {
    where.push(`EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.item_type = 'membership' AND si.item_id = ANY($${idx++}::uuid[]))`);
    values.push(filters.membership_ids);
  } else if (filters.membership_id) {
    where.push(`EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.item_type = 'membership' AND si.item_id = $${idx++})`);
    values.push(filters.membership_id);
  }
  if (filters.search?.trim()) {
    // Matches if the sale has ANY service or product line item whose name
    // contains the search text — combined Service+Product name search.
    where.push(`EXISTS (
      SELECT 1 FROM sale_items si3
      WHERE si3.sale_id = s.id AND si3.item_type IN ('service', 'product') AND si3.name ILIKE $${idx++}
    )`);
    values.push(`%${filters.search.trim()}%`);
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

// Shared CTE chain — item_agg groups by each ITEM's own resolved staff (so a
// sale split across multiple staff attributes each item's count/revenue to
// whoever actually did it), while sale_agg groups by the SALE's own resolved
// staff (so collected/due money is only ever counted once per invoice, never
// once per staff who happened to touch it — that would inflate total money
// collected across the report). commission comes straight from
// commission_earned, already computed per staff per sale at checkout time.
_STAFF_PERFORMANCE_AGG(where: string): string {
  return `
    WITH filtered_sales AS (
      SELECT
        s.id, s.total_amount,
        COALESCE(
          s.staff_id,
          (SELECT si.staff_id FROM sale_items si WHERE si.sale_id = s.id AND si.staff_id IS NOT NULL LIMIT 1)
        ) AS resolved_staff_id,
        CASE
          WHEN s.appointment_id IS NOT NULL THEN pay.paid_from_payments
          WHEN s.status = 'completed' THEN s.total_amount::numeric
          ELSE 0
        END AS paid_amount,
        COALESCE(pay.latest_due, 0) AS due_amount
      FROM sales s
      LEFT JOIN clients c ON s.client_id = c.id
      ${this._PAYMENT_LATERAL}
      WHERE ${where}
    ),
    item_agg AS (
      SELECT
        COALESCE(si.staff_id, fs.resolved_staff_id) AS staff_id,
        COUNT(DISTINCT fs.id) AS invoice_count,
        COUNT(*) FILTER (WHERE si.item_type = 'service') AS service_count,
        COALESCE(SUM(si.total_price) FILTER (WHERE si.item_type = 'service'), 0) AS service_revenue,
        COUNT(*) FILTER (WHERE si.item_type = 'product') AS product_count,
        COALESCE(SUM(si.total_price) FILTER (WHERE si.item_type = 'product'), 0) AS product_revenue,
        COUNT(*) FILTER (WHERE si.item_type = 'package') AS package_count,
        COALESCE(SUM(si.total_price) FILTER (WHERE si.item_type = 'package'), 0) AS package_revenue,
        COUNT(*) FILTER (WHERE si.item_type = 'membership') AS membership_count,
        COALESCE(SUM(si.total_price) FILTER (WHERE si.item_type = 'membership'), 0) AS membership_revenue
      FROM sale_items si
      JOIN filtered_sales fs ON fs.id = si.sale_id
      GROUP BY COALESCE(si.staff_id, fs.resolved_staff_id)
    ),
    sale_agg AS (
      SELECT
        resolved_staff_id AS staff_id,
        COALESCE(SUM(paid_amount), 0) AS collected,
        COALESCE(SUM(due_amount), 0) AS due
      FROM filtered_sales
      GROUP BY resolved_staff_id
    ),
    comm_agg AS (
      SELECT ce.staff_id, COALESCE(SUM(ce.commission_amount), 0) AS commission
      FROM commission_earned ce
      WHERE ce.sale_id IN (SELECT id FROM filtered_sales)
      GROUP BY ce.staff_id
    ),
    combined AS (
      SELECT
        st.id AS staff_id,
        NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff_name,
        st.avatar_url AS staff_avatar,
        st.phone AS contact,
        item_agg.invoice_count,
        item_agg.service_count, item_agg.service_revenue,
        item_agg.product_count, item_agg.product_revenue,
        item_agg.package_count, item_agg.package_revenue,
        item_agg.membership_count, item_agg.membership_revenue,
        (item_agg.service_revenue + item_agg.product_revenue + item_agg.package_revenue + item_agg.membership_revenue) AS total_revenue,
        COALESCE(sale_agg.collected, 0) AS collected,
        COALESCE(sale_agg.due, 0) AS due,
        COALESCE(comm_agg.commission, 0) AS commission
      FROM staff st
      -- INNER, not LEFT — only staff with actual activity in the filtered
      -- range appear at all (same "only rows with real history" convention
      -- every other per-entity report in this file already follows).
      JOIN item_agg ON item_agg.staff_id = st.id
      LEFT JOIN sale_agg ON sale_agg.staff_id = st.id
      LEFT JOIN comm_agg ON comm_agg.staff_id = st.id
      WHERE st.salon_id = $1
    )
  `;
},

async getStaffPerformanceReportStats(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; staff_ids?: string[]; branch_id?: string;
    payment_mode?: string; payment_modes?: string[];
    payment_status?: string; payment_statuses?: string[];
    item_type?: string; item_types?: string[];
    service_id?: string; product_id?: string;
    package_id?: string; package_ids?: string[];
    membership_id?: string; membership_ids?: string[];
  }
): Promise<StaffPerformanceReportStats> {
  const { where, values } = this._buildStaffPerformanceWhere(salonId, filters);

  const query = `
    ${this._STAFF_PERFORMANCE_AGG(where)}
    SELECT
      COUNT(*)::int AS total_staff,
      COALESCE(SUM(total_revenue), 0) AS total_revenue,
      COALESCE(SUM(service_revenue), 0) AS service_revenue,
      COALESCE(SUM(product_revenue), 0) AS product_revenue,
      COALESCE(SUM(package_revenue), 0) AS package_revenue,
      COALESCE(SUM(membership_revenue), 0) AS membership_revenue,
      COALESCE(SUM(commission), 0) AS total_commission
    FROM combined
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  const totalStaff = Number(r.total_staff ?? 0);
  const totalRevenue = Number(r.total_revenue ?? 0);
  return {
    total_staff: totalStaff,
    total_revenue: totalRevenue,
    service_revenue: Number(r.service_revenue ?? 0),
    product_revenue: Number(r.product_revenue ?? 0),
    package_revenue: Number(r.package_revenue ?? 0),
    membership_revenue: Number(r.membership_revenue ?? 0),
    total_commission: Number(r.total_commission ?? 0),
    avg_revenue_per_staff: totalStaff > 0 ? totalRevenue / totalStaff : 0,
  };
},

async getStaffPerformanceReport(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; staff_ids?: string[]; branch_id?: string;
    payment_mode?: string; payment_modes?: string[];
    payment_status?: string; payment_statuses?: string[];
    item_type?: string; item_types?: string[];
    service_id?: string; product_id?: string;
    package_id?: string; package_ids?: string[];
    membership_id?: string; membership_ids?: string[];
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: StaffPerformanceReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildStaffPerformanceWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    ${this._STAFF_PERFORMANCE_AGG(where)}
    SELECT *, COUNT(*) OVER() AS total_count
    FROM combined
    ORDER BY total_revenue DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: StaffPerformanceReportRow[] = rows.map((row: any) => {
    const invoiceCount = Number(row.invoice_count ?? 0);
    const totalRevenue = Number(row.total_revenue ?? 0);
    return {
      staff_id: row.staff_id,
      staff_name: row.staff_name ?? "—",
      staff_avatar: row.staff_avatar ?? null,
      contact: row.contact ?? "—",
      invoice_count: invoiceCount,
      service_count: Number(row.service_count ?? 0),
      service_revenue: Number(row.service_revenue ?? 0),
      product_count: Number(row.product_count ?? 0),
      product_revenue: Number(row.product_revenue ?? 0),
      package_count: Number(row.package_count ?? 0),
      package_revenue: Number(row.package_revenue ?? 0),
      membership_count: Number(row.membership_count ?? 0),
      membership_revenue: Number(row.membership_revenue ?? 0),
      total_revenue: totalRevenue,
      avg_bill: invoiceCount > 0 ? totalRevenue / invoiceCount : 0,
      commission: Number(row.commission ?? 0),
      collected: Number(row.collected ?? 0),
      due: Number(row.due ?? 0),
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

async getStaffPerformanceFiltersAvailable(salonId: string): Promise<StaffPerformanceFiltersAvailable> {
  const { rows: staffRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT st.id, TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))) AS label
     FROM sale_items si
     JOIN sales s ON s.id = si.sale_id
     JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
     WHERE s.salon_id = $1 AND s.status <> 'draft'
     ORDER BY label ASC`,
    [salonId]
  ));
  const { rows: branchRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT b.id, b.name AS label
     FROM staff st
     JOIN branches b ON b.id = st.branch_id
     WHERE st.salon_id = $1
     ORDER BY label ASC`,
    [salonId]
  ));
  const { rows: paymentModeRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT payment_method
     FROM sales
     WHERE salon_id = $1 AND status <> 'draft' AND payment_method IS NOT NULL
     ORDER BY payment_method ASC`,
    [salonId]
  ));
  const { rows: serviceRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT si.item_id AS id, si.name AS label
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.salon_id = $1 AND s.status <> 'draft' AND si.item_type = 'service' AND si.item_id IS NOT NULL
     ORDER BY si.name ASC`,
    [salonId]
  ));
  const { rows: productRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT si.item_id AS id, si.name AS label
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.salon_id = $1 AND s.status <> 'draft' AND si.item_type = 'product' AND si.item_id IS NOT NULL
     ORDER BY si.name ASC`,
    [salonId]
  ));
  const { rows: packageRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT si.item_id AS id, si.name AS label
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.salon_id = $1 AND s.status <> 'draft' AND si.item_type = 'package' AND si.item_id IS NOT NULL
     ORDER BY si.name ASC`,
    [salonId]
  ));
  const { rows: membershipRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT si.item_id AS id, si.name AS label
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.salon_id = $1 AND s.status <> 'draft' AND si.item_type = 'membership' AND si.item_id IS NOT NULL
     ORDER BY si.name ASC`,
    [salonId]
  ));

  return {
    staff: staffRows.map((r: any) => ({ id: r.id, label: r.label })),
    branches: branchRows.map((r: any) => ({ id: r.id, label: r.label })),
    payment_modes: paymentModeRows.map((r: any) => String(r.payment_method)),
    services: serviceRows.map((r: any) => ({ id: r.id, label: r.label })),
    products: productRows.map((r: any) => ({ id: r.id, label: r.label })),
    packages: packageRows.map((r: any) => ({ id: r.id, label: r.label })),
    memberships: membershipRows.map((r: any) => ({ id: r.id, label: r.label })),
  };
},

// ======================================================
// STAFF ITEM SALES REPORT (independent report API)
// POST /api/report/staff-item-sales — reads sale_items directly, one
// item_type at a time (service/product/membership/package), one row per
// line item. Never calls the Appointment API/service.
// ======================================================

_buildStaffItemSalesWhere(
  salonId: string,
  filters: { start_date?: string; end_date?: string; item_type?: string; staff_id?: string; search?: string }
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
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(si.name, '') ILIKE $${idx}
      OR COALESCE(st.first_name, '') ILIKE $${idx}
      OR COALESCE(st.last_name, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

async getStaffItemSalesReportStats(
  salonId: string,
  filters: { start_date?: string; end_date?: string; item_type?: string; staff_id?: string; search?: string }
): Promise<StaffItemSalesReportStats> {
  const { where, values } = this._buildStaffItemSalesWhere(salonId, filters);

  const query = `
    WITH filtered AS (
      SELECT
        si.name,
        -- Package/membership-redeemed sales already recognized this revenue
        -- when the package/membership itself was sold — counting it again
        -- here would double-count it, so these show as 0 rather than the
        -- item's face price. Package: sales.payment_method is the explicit
        -- 'package' flag set at checkout. Membership: no such flag exists,
        -- so fall back to whether membership wallet money was drawn on this
        -- sale's appointment (same signal Sales Summary uses for its
        -- "Membership" payment-source badge).
        CASE
          WHEN LOWER(COALESCE(s.payment_method, '')) = 'package' THEN 0
          WHEN COALESCE(mw.membership_wallet_used, 0) > 0 THEN 0
          ELSE si.total_price + (
            CASE WHEN COALESCE(s.subtotal, 0) > 0
                 THEN COALESCE(s.tax_amount, 0) * (si.total_price / s.subtotal)
                 ELSE 0
            END
          )
        END AS total_price,
        si.quantity,
        NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff_name,
        s.created_at
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(p.membership_wallet_used), 0) AS membership_wallet_used
        FROM payments p
        WHERE p.appointment_id = s.appointment_id AND s.appointment_id IS NOT NULL
          AND p.status IN ('completed', 'partial')
      ) mw ON TRUE
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
    start_date?: string; end_date?: string; item_type?: string; staff_id?: string; search?: string;
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
      -- See getStaffItemSalesReportStats for why package/membership-redeemed
      -- sales show 0 revenue here instead of the item's face price.
      CASE
        WHEN LOWER(COALESCE(s.payment_method, '')) = 'package' THEN 0
        WHEN COALESCE(mw.membership_wallet_used, 0) > 0 THEN 0
        ELSE si.total_price + (
          CASE WHEN COALESCE(s.subtotal, 0) > 0
               THEN COALESCE(s.tax_amount, 0) * (si.total_price / s.subtotal)
               ELSE 0
          END
        )
      END AS revenue,
      TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date,
      COUNT(*) OVER() AS total_count
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN staff st ON st.id = COALESCE(si.staff_id, s.staff_id)
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(p.membership_wallet_used), 0) AS membership_wallet_used
      FROM payments p
      WHERE p.appointment_id = s.appointment_id AND s.appointment_id IS NOT NULL
        AND p.status IN ('completed', 'partial')
    ) mw ON TRUE
    WHERE ${where}
    ORDER BY s.created_at DESC
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
  filters: {
    start_date?: string; end_date?: string; search?: string;
    staff_ids?: string[]; package_name?: string; package_status?: string;
    payment_status?: string; payment_method?: string;
    min_amount?: number; max_amount?: number;
  }
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
  if (filters.staff_ids && filters.staff_ids.length > 0) {
    where.push(`cp.staff_id = ANY($${idx++}::uuid[])`);
    values.push(filters.staff_ids);
  }
  if (filters.package_name) {
    where.push(`cp.package_name = $${idx++}`);
    values.push(filters.package_name);
  }
  if (filters.package_status) {
    where.push(`cp.status = $${idx++}`);
    values.push(filters.package_status);
  }
  if (filters.payment_status) {
    where.push(`cp.payment_status = $${idx++}`);
    values.push(filters.payment_status);
  }
  if (filters.payment_method) {
    where.push(`cp.payment_method = $${idx++}`);
    values.push(filters.payment_method);
  }
  if (filters.min_amount !== undefined) {
    where.push(`cp.total_amount::numeric >= $${idx++}`);
    values.push(filters.min_amount);
  }
  if (filters.max_amount !== undefined) {
    where.push(`cp.total_amount::numeric <= $${idx++}`);
    values.push(filters.max_amount);
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
  filters: {
    start_date?: string; end_date?: string; search?: string;
    staff_ids?: string[]; package_name?: string; package_status?: string;
    payment_status?: string; payment_method?: string;
    min_amount?: number; max_amount?: number;
  }
): Promise<PackageSaleReportStats> {
  const { where, values } = this._buildPackageSaleWhere(salonId, filters);

  const query = `
    SELECT
      COUNT(*)::int AS packages_sold,
      COALESCE(SUM(cp.total_amount::numeric), 0) AS total_sale_value,
      COALESCE(SUM(cp.paid_amount::numeric), 0) AS total_received,
      COALESCE(SUM(cp.pending_amount::numeric), 0) AS outstanding_balance,
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
    outstanding_balance: Number(r.outstanding_balance ?? 0),
  };
},

async getPackageSaleReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string;
    staff_ids?: string[]; package_name?: string; package_status?: string;
    payment_status?: string; payment_method?: string;
    min_amount?: number; max_amount?: number;
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
      TO_CHAR(cp.created_date AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date,
      cp.client_id,
      cp.client_name,
      cp.package_name,
      cp.total_amount,
      cp.paid_amount,
      cp.pending_amount,
      cp.payment_status,
      cp.gst_amount,
      s.invoice_number AS invoice_no,
      st.id AS staff_id,
      NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff_name,
      cp.payment_method,
      cp.status,
      COUNT(*) OVER() AS total_count
    FROM client_packages cp
    LEFT JOIN sales s ON s.id = cp.sale_id
    LEFT JOIN staff st ON st.id = cp.staff_id
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
    gst_amount: Number(row.gst_amount ?? 0),
    invoice_no: row.invoice_no ?? null,
    staff_id: row.staff_id ?? null,
    staff_name: row.staff_name ?? null,
    payment_method: row.payment_method,
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

// Distinct staff/package names that have EVER appeared in this salon's
// package sales — scoped only to salon_id, not the current date/filters, so
// the dropdowns stay complete.
async getPackageSaleFiltersAvailable(salonId: string): Promise<{
  staff: PackageSaleFilterOption[];
  packages: string[];
}> {
  const { rows: staffRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT st.id, TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))) AS label
     FROM client_packages cp
     JOIN staff st ON st.id = cp.staff_id
     WHERE cp.salon_id = $1
     ORDER BY label ASC`,
    [salonId]
  ));

  const { rows: packageRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT package_name
     FROM client_packages
     WHERE salon_id = $1
     ORDER BY package_name ASC`,
    [salonId]
  ));

  return {
    staff: staffRows.map((r: any) => ({ id: r.id, label: r.label })),
    packages: packageRows.map((r: any) => String(r.package_name)),
  };
},

// ======================================================
// PACKAGE HISTORY REPORT (independent report API)
// POST /api/report/package-history — reads client_package_session_history
// directly, joined to client_package_services/client_packages, one row per
// session. Never calls the Appointment API.
// ======================================================

// client_packages.status only ever persists 'Active'/'Completed' (already
// correctly auto-flipped by completeSession() the instant every service's
// sessions are exhausted — see that function's comment). "Expired" isn't a
// stored value at all, so it's derived here from expiry_date vs now(). Any
// package that isn't Complete or Expired is Ongoing — deliberately not
// gating on "at least one session completed" the way the ticket's prose
// example implies, since a freshly-sold, not-yet-started package still
// needs to land in exactly one of these three buckets (Ongoing is that
// default "still has sessions, hasn't expired" bucket).
_PACKAGE_STATUS_EXPR: `
  CASE
    WHEN cp.status = 'Completed' THEN 'complete'
    WHEN cp.expiry_date < NOW() THEN 'expired'
    ELSE 'ongoing'
  END
`,

async _resolveStaffNames(salonId: string, staffIds: string[]): Promise<string[]> {
  if (!staffIds.length) return [];
  const { rows } = await safeQuery(() => pool.query(
    `SELECT TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))) AS full_name
     FROM staff WHERE id = ANY($1::uuid[]) AND salon_id = $2`,
    [staffIds, salonId]
  ));
  return rows.map((r: any) => String(r.full_name)).filter(Boolean);
},

async _buildPackageHistoryWhere(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string;
    package_name?: string; service_name?: string; staff_ids?: string[]; status?: string;
  }
): Promise<{ where: string; values: any[]; nextIndex: number }> {
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
  if (filters.package_name) {
    where.push(`cp.package_name = $${idx++}`);
    values.push(filters.package_name);
  }
  if (filters.service_name) {
    where.push(`cps.service_name = $${idx++}`);
    values.push(filters.service_name);
  }
  if (filters.staff_ids && filters.staff_ids.length > 0) {
    // client_package_session_history has no staff_id FK, only a denormalized
    // staff_name — resolve the picked staff ids to names first (see
    // _resolveStaffNames), then match on those.
    const names = await this._resolveStaffNames(salonId, filters.staff_ids);
    where.push(names.length > 0 ? `h.staff_name = ANY($${idx++}::text[])` : "FALSE");
    if (names.length > 0) values.push(names);
  }
  if (filters.status) {
    where.push(`(${this._PACKAGE_STATUS_EXPR}) = $${idx++}`);
    values.push(filters.status);
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

async getPackageHistoryFiltersAvailable(salonId: string): Promise<PackageHistoryFiltersAvailable> {
  const { rows: pkgRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT package_name FROM client_packages WHERE salon_id = $1 ORDER BY package_name ASC`,
    [salonId]
  ));
  const { rows: svcRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT cps.service_name
     FROM client_package_services cps
     JOIN client_packages cp ON cp.id = cps.client_package_id
     WHERE cp.salon_id = $1
     ORDER BY cps.service_name ASC`,
    [salonId]
  ));
  return {
    packages: pkgRows.map((r: any) => String(r.package_name)),
    services: svcRows.map((r: any) => String(r.service_name)),
  };
},

async getPackageHistoryReportStats(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string;
    package_name?: string; service_name?: string; staff_ids?: string[]; status?: string;
  }
): Promise<PackageHistoryReportStats> {
  const { where, values } = await this._buildPackageHistoryWhere(salonId, filters);

  const query = `
    WITH matched_history AS (
      SELECT cp.id AS pkg_id
      FROM client_package_session_history h
      JOIN client_package_services cps ON cps.id = h.client_package_service_id
      JOIN client_packages cp ON cp.id = h.client_package_id
      WHERE ${where}
    ),
    distinct_pkgs AS (
      SELECT DISTINCT cp.id, cp.status AS raw_status, cp.expiry_date
      FROM client_packages cp
      WHERE cp.id IN (SELECT pkg_id FROM matched_history)
    ),
    -- Capacity-based, not an event count: every client_package_session_history
    -- row is always status='Completed' (nothing else is ever written there),
    -- so counting history rows made "Total Sessions" identically equal
    -- "Completed Sessions" — always, for every filter. These are summed from
    -- the service-level session allocation instead, so Total = Completed +
    -- Remaining actually reconciles like the cards imply it should.
    pkg_computed AS (
      SELECT
        dp.id,
        CASE
          WHEN dp.raw_status = 'Completed' THEN 'complete'
          WHEN dp.expiry_date < NOW() THEN 'expired'
          ELSE 'ongoing'
        END AS status,
        COALESCE((
          SELECT SUM(cps.total_sessions)
          FROM client_package_services cps WHERE cps.client_package_id = dp.id
        ), 0) AS total_sessions,
        COALESCE((
          SELECT SUM(cps.completed_sessions)
          FROM client_package_services cps WHERE cps.client_package_id = dp.id
        ), 0) AS completed_sessions,
        COALESCE((
          SELECT SUM(cps.total_sessions - cps.completed_sessions)
          FROM client_package_services cps WHERE cps.client_package_id = dp.id
        ), 0) AS remaining_sessions
      FROM distinct_pkgs dp
    )
    SELECT
      COALESCE((SELECT SUM(total_sessions) FROM pkg_computed), 0)::int AS total_sessions,
      COALESCE((SELECT SUM(completed_sessions) FROM pkg_computed), 0)::int AS completed_sessions,
      COALESCE((SELECT SUM(remaining_sessions) FROM pkg_computed), 0)::int AS remaining_sessions,
      COALESCE((SELECT COUNT(*) FROM pkg_computed WHERE status = 'ongoing'), 0)::int AS ongoing_packages,
      COALESCE((SELECT COUNT(*) FROM pkg_computed WHERE status = 'complete'), 0)::int AS completed_packages,
      COALESCE((SELECT COUNT(*) FROM pkg_computed WHERE status = 'expired'), 0)::int AS expired_packages
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  return {
    total_sessions: Number(r.total_sessions ?? 0),
    completed_sessions: Number(r.completed_sessions ?? 0),
    remaining_sessions: Number(r.remaining_sessions ?? 0),
    ongoing_packages: Number(r.ongoing_packages ?? 0),
    completed_packages: Number(r.completed_packages ?? 0),
    expired_packages: Number(r.expired_packages ?? 0),
  };
},

async getPackageHistoryReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string;
    package_name?: string; service_name?: string; staff_ids?: string[]; status?: string;
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: PackageHistoryReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = await this._buildPackageHistoryWhere(salonId, filters);
  let idx = nextIndex;

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${idx++} OFFSET $${idx++}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    SELECT
      TO_CHAR(h.session_date AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date,
      cp.client_id,
      cp.client_name,
      cp.package_name,
      cps.service_name,
      h.session_no,
      (cps.total_sessions - cps.completed_sessions) AS remaining_sessions,
      h.staff_name AS staff,
      (${this._PACKAGE_STATUS_EXPR}) AS status,
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
    remaining_sessions: Number(row.remaining_sessions ?? 0),
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

// client_memberships.status is only ever persisted as 'active' or
// 'exhausted' (see client-memberships.repository.ts — nothing ever writes
// 'expired'), so real-world expiry has to be derived here from expires_at
// vs now(). 'exhausted' is remapped to 'complete' — a membership that used
// up all its sessions/value is done, not an error state ("Exhausted" is
// being retired from the UI entirely). 7-day lookahead window for
// "Expiry Soon", same convention as a typical renewal-reminder threshold.
_MEMBER_STATUS_EXPR: `
  CASE
    WHEN cm.status = 'exhausted' THEN 'complete'
    WHEN cm.expires_at IS NOT NULL AND cm.expires_at < NOW() THEN 'expired'
    WHEN cm.expires_at IS NOT NULL AND cm.expires_at < NOW() + INTERVAL '7 days' THEN 'expiry_soon'
    ELSE 'active'
  END
`,

_buildMemberSaleWhere(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string; status?: string;
    membership_id?: string; staff_ids?: string[]; pricing_type?: string;
    price_min?: number; price_max?: number;
  }
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
      OR COALESCE(cm.mobile, '') ILIKE $${idx}
      OR COALESCE(cm.membership_name, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }
  if (filters.status) {
    where.push(`(${this._MEMBER_STATUS_EXPR}) = $${idx++}`);
    values.push(filters.status);
  }
  if (filters.membership_id) {
    where.push(`cm.membership_id = $${idx++}`);
    values.push(filters.membership_id);
  }
  if (filters.staff_ids && filters.staff_ids.length > 0) {
    where.push(`cm.staff_id = ANY($${idx++}::uuid[])`);
    values.push(filters.staff_ids);
  }
  if (filters.pricing_type) {
    where.push(`cm.pricing_type = $${idx++}`);
    values.push(filters.pricing_type);
  }
  if (filters.price_min != null) {
    where.push(`cm.price_paid >= $${idx++}`);
    values.push(filters.price_min);
  }
  if (filters.price_max != null) {
    where.push(`cm.price_paid <= $${idx++}`);
    values.push(filters.price_max);
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

// Membership catalog is loosely-typed free text (often a JSON blob a salon
// owner pasted in while setting up the plan, sometimes double-encoded — see
// e.g. "GoldMembership2026" in dev data) rather than a dedicated "extra
// benefits" field. Best-effort unwrap: pull out a nested `.description`
// string if present, otherwise fall back to the raw text as-is.
_extractExtraBenefits(raw: string | null): string {
  if (!raw || !raw.trim()) return "—";
  let text: string = raw;
  try {
    let parsed: any = JSON.parse(raw);
    let guard = 0;
    while (parsed && typeof parsed === "object" && typeof parsed.description === "string" && guard < 3) {
      const inner = parsed.description;
      try {
        parsed = JSON.parse(inner);
      } catch {
        text = inner;
        parsed = null;
      }
      guard++;
    }
    if (typeof parsed === "string") text = parsed;
  } catch {
    // Not JSON — use the raw text as-is.
  }
  return text.trim() || "—";
},

async getMemberSaleReportStats(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string; status?: string;
    membership_id?: string; staff_ids?: string[]; pricing_type?: string;
    price_min?: number; price_max?: number;
  }
): Promise<MemberSaleReportStats> {
  const { where, values } = this._buildMemberSaleWhere(salonId, filters);

  const query = `
    SELECT
      COUNT(*)::int AS memberships_sold,
      COALESCE(SUM(cm.price_paid::numeric), 0) AS total_revenue,
      COUNT(*) FILTER (WHERE (${this._MEMBER_STATUS_EXPR}) = 'active')::int AS active_memberships,
      COUNT(*) FILTER (WHERE (${this._MEMBER_STATUS_EXPR}) = 'expiry_soon')::int AS expiry_soon_memberships,
      COUNT(*) FILTER (WHERE (${this._MEMBER_STATUS_EXPR}) = 'expired')::int AS expired_memberships,
      COUNT(*) FILTER (WHERE (${this._MEMBER_STATUS_EXPR}) = 'complete')::int AS completed_memberships
    FROM client_memberships cm
    WHERE ${where}
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  return {
    memberships_sold: Number(r.memberships_sold ?? 0),
    total_revenue: Number(r.total_revenue ?? 0),
    active_memberships: Number(r.active_memberships ?? 0),
    expiry_soon_memberships: Number(r.expiry_soon_memberships ?? 0),
    expired_memberships: Number(r.expired_memberships ?? 0),
    completed_memberships: Number(r.completed_memberships ?? 0),
  };
},

async getMemberSaleFiltersAvailable(salonId: string): Promise<MemberSaleFiltersAvailable> {
  const { rows } = await safeQuery(() => pool.query(
    `SELECT id, name AS label FROM memberships WHERE salon_id = $1 ORDER BY name ASC`,
    [salonId]
  ));
  const { rows: staffRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT st.id, TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))) AS label
     FROM client_memberships cm
     JOIN staff st ON st.id = cm.staff_id
     WHERE cm.salon_id = $1
     ORDER BY label ASC`,
    [salonId]
  ));
  const { rows: typeRows } = await safeQuery(() => pool.query(
    `SELECT DISTINCT pricing_type FROM client_memberships WHERE salon_id = $1 AND pricing_type IS NOT NULL ORDER BY pricing_type ASC`,
    [salonId]
  ));
  return {
    memberships: rows.map((r: any) => ({ id: r.id, label: r.label })),
    staff: staffRows.map((r: any) => ({ id: r.id, label: r.label })),
    pricing_types: typeRows.map((r: any) => String(r.pricing_type)),
  };
},

async getMemberSaleReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string; status?: string;
    membership_id?: string; staff_ids?: string[]; pricing_type?: string;
    price_min?: number; price_max?: number;
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
      TO_CHAR(cm.purchased_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS purchased_at,
      s.invoice_number,
      cm.client_name,
      NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff_name,
      cm.membership_name,
      cm.pricing_type,
      -- The configured plan benefit (flat credit or discount %), not what
      -- the client paid — that's price_paid below, a separate column.
      CASE
        WHEN cm.pricing_type = 'percentage' THEN cm.discount_percent
        WHEN cm.pricing_type = 'value' THEN m.price
        ELSE NULL
      END AS value_amount,
      m.description AS membership_description,
      cm.price_paid,
      cm.payment_method,
      (${this._MEMBER_STATUS_EXPR}) AS status,
      COUNT(*) OVER() AS total_count
    FROM client_memberships cm
    LEFT JOIN memberships m ON m.id = cm.membership_id
    LEFT JOIN staff st ON st.id = cm.staff_id
    LEFT JOIN sales s ON s.id = cm.sale_id
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
    invoice_number: row.invoice_number,
    client_name: row.client_name,
    staff_name: row.staff_name ?? "—",
    membership_name: row.membership_name,
    pricing_type: row.pricing_type,
    value_amount: row.value_amount != null ? Number(row.value_amount) : null,
    extra_benefits: this._extractExtraBenefits(row.membership_description),
    price_paid: Number(row.price_paid ?? 0),
    payment_method: row.payment_method,
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
    search?: string; payment_methods?: string[]; staff_ids?: string[];
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: AppointmentDetailReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const values: any[] = [salonId];
  const where = ["a.salon_id = $1"];
  let idx = 2;

  // Anchored to +05:30 (IST) day boundaries, not the DB session's UTC —
  // see the identical fix/comment in appointments.repository.ts::listBySalonId.
  // Casting a bare "YYYY-MM-DD" to ::date compares against UTC midnight
  // (05:30 IST), silently dropping/shifting appointments booked in the
  // IST 00:00–05:30 window across the date boundary.
  if (filters.from) {
    where.push(`a.scheduled_at >= $${idx++}::timestamptz`);
    values.push(`${filters.from}T00:00:00+05:30`);
  }
  if (filters.to) {
    where.push(`a.scheduled_at < ($${idx++}::timestamptz + interval '1 day')`);
    values.push(`${filters.to}T00:00:00+05:30`);
  }
  if (filters.statuses && filters.statuses.length > 0) {
    // appointments.status is a native Postgres ENUM (appointment_status),
    // not text — `a.status = ANY($n::text[])` throws "operator does not
    // exist: appointment_status = text" (no implicit enum/text comparison),
    // which safeQuery lets propagate, failing the whole report request
    // whenever any status filter is applied. Casting the column itself to
    // text lets it compare against the plain text[] array from the request.
    where.push(`a.status::text = ANY($${idx++}::text[])`);
    values.push(filters.statuses);
  }
  // No `else` branch excluding 'deleted' here on purpose — with no status
  // filter applied, every status (including deleted) shows by default, same
  // as any other status. Previously this had a hardcoded `a.deleted_at IS
  // NULL`, which — since deletion sets both status='deleted' AND
  // deleted_at=NOW() together (appointments.repository.ts `UPDATE
  // appointments SET status = 'deleted', deleted_at = NOW()`) — silently
  // dropped every deleted row unconditionally, even when the caller
  // explicitly asked for statuses=['deleted']; the "Deleted" status filter
  // could never return anything. Product decision: deleted appointments stay
  // visible in the report by default (not hidden) so deleting one doesn't
  // make it disappear from view entirely — confirmed with the report owner.

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 10));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;

  // Outer-query filters (search/payment method/staff) run against columns
  // only available after exploding+joining, so they're built as a second
  // WHERE list applied to the final SELECT rather than folded into `where`
  // above (which only scopes the `matched` CTE against raw appointments
  // columns).
  const outerWhere: string[] = [];
  if (filters.search?.trim()) {
    outerWhere.push(`(
      COALESCE(e.client_name, '') ILIKE $${idx}
      OR COALESCE(e.phone_number, '') ILIKE $${idx}
      OR COALESCE(e.invoice_number, '') ILIKE $${idx}
      OR COALESCE(e.item_name, '') ILIKE $${idx}
      OR COALESCE(e.staff_name, '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }
  if (filters.payment_methods && filters.payment_methods.length > 0) {
    // payment_method is a free-text label ("Cash", "Card", "Cash+Card", ...),
    // not a fixed enum, so an exact match on "Cash" would miss split
    // payments like "Cash+Card" — match by substring per selected method
    // instead (confirmed with product owner).
    outerWhere.push(`(${filters.payment_methods.map(() => `e.payment_method ILIKE $${idx++}`).join(" OR ")})`);
    filters.payment_methods.forEach(m => values.push(`%${m}%`));
  }
  if (filters.staff_ids && filters.staff_ids.length > 0) {
    outerWhere.push(`COALESCE(
      CASE WHEN e.item_staff_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN e.item_staff_id::uuid END,
      e.staff_id
    ) = ANY($${idx++}::uuid[])`);
    values.push(filters.staff_ids);
  }
  const outerWhereClause = outerWhere.length ? `WHERE ${outerWhere.join(" AND ")}` : "";

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
        m.id, m.scheduled_at, m.duration_minutes, m.created_at, m.client_id, m.staff_id, m.status,
        'service' AS item_type,
        svc.value->>'name' AS item_name,
        NULLIF(svc.value->>'staff_id', '') AS item_staff_id,
        NULLIF(svc.value->>'staff_name', '') AS item_staff_name,
        COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0) AS item_price
      FROM matched m
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(m.services, '[]'::jsonb)) AS svc(value) ON TRUE
      WHERE svc.value IS NOT NULL

      UNION ALL

      SELECT
        m.id, m.scheduled_at, m.duration_minutes, m.created_at, m.client_id, m.staff_id, m.status,
        'product' AS item_type,
        prod.value->>'name' AS item_name,
        NULLIF(prod.value->>'staff_id', '') AS item_staff_id,
        NULLIF(prod.value->>'staff_name', '') AS item_staff_name,
        COALESCE(NULLIF(prod.value->>'price', '')::numeric, 0) AS item_price
      FROM matched m
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(m.product_items, '[]'::jsonb)) AS prod(value) ON TRUE
      WHERE prod.value IS NOT NULL

      UNION ALL

      SELECT
        m.id, m.scheduled_at, m.duration_minutes, m.created_at, m.client_id, m.staff_id, m.status,
        'package' AS item_type,
        pkg.value->>'name' AS item_name,
        NULLIF(pkg.value->>'staff_id', '') AS item_staff_id,
        NULLIF(pkg.value->>'staff_name', '') AS item_staff_name,
        COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0) AS item_price
      FROM matched m
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(m.package_items, '[]'::jsonb)) AS pkg(value) ON TRUE
      WHERE pkg.value IS NOT NULL

      UNION ALL

      SELECT
        m.id, m.scheduled_at, m.duration_minutes, m.created_at, m.client_id, m.staff_id, m.status,
        'membership' AS item_type,
        mem.value->>'name' AS item_name,
        NULLIF(mem.value->>'staff_id', '') AS item_staff_id,
        NULLIF(mem.value->>'staff_name', '') AS item_staff_name,
        COALESCE(NULLIF(mem.value->>'price', '')::numeric, 0) AS item_price
      FROM matched m
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(m.membership_items, '[]'::jsonb)) AS mem(value) ON TRUE
      WHERE mem.value IS NOT NULL
    ),
    base AS (
      SELECT
        e.*,
        -- DB session runs in UTC (see config/database.ts) — TO_CHAR on a bare
        -- timestamptz here silently formatted the UTC instant, not the IST
        -- wall-clock time the booking was made for, so this report's Time
        -- column disagreed with the Booking Details page (which the frontend
        -- renders from the raw scheduled_at, converted to IST in the
        -- browser). Converting explicitly to IST here keeps this report's
        -- formatted strings consistent with every other screen.
        TO_CHAR(e.scheduled_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS appointment_date,
        TO_CHAR(e.scheduled_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS time,
        TO_CHAR(e.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS booked_date,
        c.full_name AS client_name,
        c.phone_number,
        COALESCE(
          e.item_staff_name,
          NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '')
        ) AS staff_name,
        pay.payment_method,
        pay.paid_amount,
        s.invoice_number
      FROM exploded e
      LEFT JOIN clients c ON e.client_id = c.id
      LEFT JOIN staff st ON st.id = COALESCE(
        CASE WHEN e.item_staff_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN e.item_staff_id::uuid END,
        e.staff_id
      )
      LEFT JOIN LATERAL (
        SELECT p.payment_method, p.paid_amount
        FROM payments p
        WHERE p.appointment_id = e.id
        ORDER BY p.created_at DESC
        LIMIT 1
      ) pay ON TRUE
      LEFT JOIN LATERAL (
        SELECT s.invoice_number
        FROM sales s
        WHERE s.appointment_id = e.id
        ORDER BY s.created_at DESC
        LIMIT 1
      ) s ON TRUE
    )
    SELECT
      e.id,
      e.appointment_date,
      e.time,
      e.booked_date,
      e.client_name,
      COALESCE(e.item_name, '—') AS item_name,
      e.item_type,
      e.staff_name,
      e.duration_minutes AS duration,
      COALESCE(e.paid_amount, e.item_price, 0) AS amount,
      e.payment_method,
      e.status AS payment_status,
      COUNT(*) OVER() AS total_count
    FROM base e
    ${outerWhereClause}
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
    item_name: row.item_name,
    item_type: row.item_type,
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

// ======================================================
// WA MARKETING CAMPAIGN REPORT (independent report API)
// POST /api/report/wa-campaign — reads wa_campaigns directly (template
// joined by name), one row per campaign, with per-contact status counts
// aggregated live from wa_campaign_contacts (wa_campaigns' own
// sent_count/delivered_count/etc columns are never written to after
// insert — stale, not the source of truth).
// ======================================================

_buildWaCampaignWhere(
  salonId: string,
  filters: {
    search?: string; statuses?: string[]; template_ids?: string[];
    date_from?: string; date_to?: string;
  }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["c.salon_id = $1"];
  let idx = 2;

  if (filters.search?.trim()) {
    where.push(`(
      c.name ILIKE $${idx}
      OR COALESCE(t.name, '') ILIKE $${idx}
      OR c.id::text ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }
  if (filters.statuses && filters.statuses.length > 0) {
    where.push(`c.status = ANY($${idx++}::text[])`);
    values.push(filters.statuses);
  }
  if (filters.template_ids && filters.template_ids.length > 0) {
    where.push(`c.template_id = ANY($${idx++}::uuid[])`);
    values.push(filters.template_ids);
  }
  if (filters.date_from) {
    where.push(`c.created_at >= $${idx++}::date`);
    values.push(filters.date_from);
  }
  if (filters.date_to) {
    where.push(`c.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.date_to);
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

// Delivery/read rate bucket, applied as a HAVING-equivalent filter on the
// already-aggregated per-campaign counts (sent/delivered/read only exist
// after the wa_campaign_contacts GROUP BY, so this can't be a plain WHERE).
_waCampaignBucketClause(column: "delivered" | "read", bucket?: "high" | "medium" | "low" | "none"): string | null {
  if (!bucket) return null;
  const rate = `(CASE WHEN sent = 0 THEN 0 ELSE ${column}::numeric / sent END)`;
  if (bucket === "none") return `${rate} = 0`;
  if (bucket === "low") return `sent > 0 AND ${rate} > 0 AND ${rate} < 0.5`;
  if (bucket === "medium") return `${rate} >= 0.5 AND ${rate} < 0.9`;
  return `${rate} >= 0.9`; // high
},

_WA_CAMPAIGN_AGG(where: string): string {
  return `
    WITH agg AS (
      SELECT
        c.id, c.name, c.template_id, c.status, c.created_at,
        COALESCE(t.name, 'Deleted template') AS template_name,
        COALESCE(c.total_contacts, 0) AS total_contacts,
        COUNT(cc.id) FILTER (WHERE cc.status IN ('SENT','DELIVERED','READ','FAILED','BLOCKED'))::int AS sent,
        COUNT(cc.id) FILTER (WHERE cc.status IN ('DELIVERED','READ'))::int AS delivered,
        COUNT(cc.id) FILTER (WHERE cc.status = 'READ')::int AS read,
        COUNT(cc.id) FILTER (WHERE cc.status = 'FAILED')::int AS failed,
        COUNT(cc.id) FILTER (WHERE cc.status = 'BLOCKED')::int AS blocked
      FROM wa_campaigns c
      LEFT JOIN wa_templates t ON t.id = c.template_id
      LEFT JOIN wa_campaign_contacts cc ON cc.campaign_id = c.id
      WHERE ${where}
      GROUP BY c.id, c.name, c.template_id, c.status, c.created_at, t.name, c.total_contacts
    )
  `;
},

async getWaCampaignReportStats(
  salonId: string,
  filters: {
    search?: string; statuses?: string[]; template_ids?: string[];
    date_from?: string; date_to?: string;
    delivery_bucket?: "high" | "medium" | "low" | "none";
    read_bucket?: "high" | "medium" | "low" | "none";
  }
): Promise<WaCampaignReportStats> {
  const { where, values } = this._buildWaCampaignWhere(salonId, filters);

  const bucketClauses = [
    this._waCampaignBucketClause("delivered", filters.delivery_bucket),
    this._waCampaignBucketClause("read", filters.read_bucket),
  ].filter((c): c is string => !!c);
  const havingClause = bucketClauses.length ? `WHERE ${bucketClauses.join(" AND ")}` : "";

  const query = `
    ${this._WA_CAMPAIGN_AGG(where)}
    SELECT
      COUNT(*)::int AS total_campaigns,
      COALESCE(SUM(total_contacts), 0) AS total_contacts,
      COALESCE(SUM(sent), 0) AS total_sent,
      COALESCE(SUM(delivered), 0) AS total_delivered,
      COALESCE(SUM(read), 0) AS total_read,
      COALESCE(SUM(failed), 0) AS total_failed,
      COALESCE(SUM(blocked), 0) AS total_blocked
    FROM agg
    ${havingClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  const total_sent = Number(r.total_sent ?? 0);
  const total_delivered = Number(r.total_delivered ?? 0);
  const total_read = Number(r.total_read ?? 0);
  return {
    total_campaigns: Number(r.total_campaigns ?? 0),
    total_contacts: Number(r.total_contacts ?? 0),
    total_sent,
    total_delivered,
    total_read,
    total_failed: Number(r.total_failed ?? 0),
    total_blocked: Number(r.total_blocked ?? 0),
    avg_delivery_rate: total_sent > 0 ? (total_delivered / total_sent) * 100 : 0,
    avg_read_rate: total_sent > 0 ? (total_read / total_sent) * 100 : 0,
  };
},

async getWaCampaignReportRows(
  salonId: string,
  filters: {
    search?: string; statuses?: string[]; template_ids?: string[];
    date_from?: string; date_to?: string;
    delivery_bucket?: "high" | "medium" | "low" | "none";
    read_bucket?: "high" | "medium" | "low" | "none";
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: WaCampaignReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values } = this._buildWaCampaignWhere(salonId, filters);

  const bucketClauses = [
    this._waCampaignBucketClause("delivered", filters.delivery_bucket),
    this._waCampaignBucketClause("read", filters.read_bucket),
  ].filter((c): c is string => !!c);
  const havingClause = bucketClauses.length ? `WHERE ${bucketClauses.join(" AND ")}` : "";

  const page = Math.max(1, Number(filters.page ?? 1));
  const requestedLimit = Math.max(1, Number(filters.limit ?? 25));
  const limit = filters.is_export ? undefined : Math.min(requestedLimit, 200);
  const offset = limit ? (page - 1) * limit : 0;
  const limitClause = limit ? `LIMIT $${values.length + 1} OFFSET $${values.length + 2}` : "";
  const limitValues = limit ? [limit, offset] : [];

  const query = `
    ${this._WA_CAMPAIGN_AGG(where)}
    SELECT *, COUNT(*) OVER() AS total_count
    FROM agg
    ${havingClause}
    ORDER BY created_at DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: WaCampaignReportRow[] = rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    template_id: row.template_id,
    template_name: row.template_name,
    status: row.status,
    created_at: row.created_at,
    total_contacts: Number(row.total_contacts ?? 0),
    sent: Number(row.sent ?? 0),
    delivered: Number(row.delivered ?? 0),
    read: Number(row.read ?? 0),
    failed: Number(row.failed ?? 0),
    blocked: Number(row.blocked ?? 0),
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

async getWaCampaignFiltersAvailable(salonId: string): Promise<WaCampaignFiltersAvailable> {
  const { rows } = await safeQuery(() => pool.query(
    `SELECT id, name AS label FROM wa_templates WHERE salon_id = $1 ORDER BY name ASC`,
    [salonId]
  ));
  return { templates: rows.map((r: any) => ({ id: r.id, label: r.label })) };
},

// ======================================================
// LEGACY REPORTS (dev) continued — additional service/staff/
// sales-summary-table methods restored from origin/dev.
// ======================================================

 

async getServiceRevenueCards(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status IN ('draft', 'completed', 'cancelled', 'refunded')",
    "si.item_type = 'service'",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(SUM(si.total_price), 0) AS service_revenue,
      COALESCE(SUM(si.quantity), 0) AS services_sold,
      COUNT(DISTINCT s.id) AS invoices,
      COUNT(DISTINCT s.client_id) AS guests_served,
      COALESCE(SUM(si.discount_amount), 0) AS item_discount,
      COALESCE(SUM(s.tax_amount), 0) AS tax
    FROM sales s
    JOIN sale_items si
      ON si.sale_id = s.id
    WHERE ${where.join(" AND ")}
    `,
    values
  );

  const data = rows[0];

  return {
    service_revenue: Number(data.service_revenue),
    services_sold: Number(data.services_sold),
    invoices: Number(data.invoices),
    guests_served: Number(data.guests_served),
    discount: Number(data.item_discount),
    tax: Number(data.tax),
  };
},

async getServiceRevenueTrend(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
  }
) {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status IN ('draft', 'completed', 'cancelled', 'refunded')",
    "si.item_type = 'service'",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  let groupExpr = `TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'Mon YYYY')`;

  if (filters.from && filters.to) {
    const from = new Date(filters.from);
    const to = new Date(filters.to);

    const diffDays =
      Math.floor(
        (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;

    if (diffDays === 1) {
      groupExpr = `TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'HH24:00')`;
    } else if (diffDays <= 7) {
      groupExpr = `TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'Dy')`;
    } else if (diffDays <= 31) {
      groupExpr = `TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon')`;
    } else {
      groupExpr = `TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'Mon')`;
    }
  }

  const { rows } = await pool.query(
    `
    SELECT
      ${groupExpr} AS period,
      SUM(si.total_price) AS revenue,
      SUM(si.quantity) AS quantity_sold
    FROM sales s
    INNER JOIN sale_items si
      ON si.sale_id = s.id
    WHERE ${where.join(" AND ")}
    GROUP BY 1
    ORDER BY MIN(s.created_at)
    `,
    values
  );

  return rows.map((row) => ({
    period: row.period,
    revenue: Number(row.revenue || 0),
    quantitySold: Number(row.quantity_sold || 0),
  }));
},

async getServiceCategoryRevenue(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "si.item_type = 'service'",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(sc.name, 'Others') AS name,
      SUM(si.total_price) AS revenue,
      SUM(si.quantity) AS quantity,
      ROUND(
        SUM(si.total_price) * 100.0 /
        NULLIF(SUM(SUM(si.total_price)) OVER (), 0),
        2
      ) AS percentage
    FROM sales s
    JOIN sale_items si
      ON si.sale_id = s.id
    LEFT JOIN services sv
      ON sv.id = si.item_id
    LEFT JOIN service_categories sc
      ON sc.id = sv.category_id
    WHERE ${where.join(" AND ")}
    GROUP BY sc.name
    ORDER BY revenue DESC;
    `,
    values
  );

  return rows.map((row) => ({
    name: row.name,
    revenue: Number(row.revenue),
    quantity: Number(row.quantity),
    percentage: Number(row.percentage),
  }));
},

async getTopRevenueServices(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "si.item_type = 'service'",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(si.name, sv.name) AS name,
      SUM(si.total_price) AS revenue,
      SUM(si.quantity) AS quantity
    FROM sales s
    JOIN sale_items si
      ON si.sale_id = s.id
    LEFT JOIN services sv
      ON sv.id = si.item_id
    WHERE ${where.join(" AND ")}
    GROUP BY COALESCE(si.name, sv.name)
    ORDER BY revenue DESC
    LIMIT 10;
    `,
    values
  );

  return rows.map((row) => ({
    name: row.name,
    revenue: Number(row.revenue),
    quantity: Number(row.quantity),
  }));
},


async getServiceRevenueAnalytics(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "si.item_type = 'service'",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const [
    topStaff,
    topService,
    revenueDay,
    avgSpend,
  ] = await Promise.all([
    pool.query(
      `
      SELECT
        COALESCE(
          NULLIF(line_match.staff_name, ''),
          NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''),
          'Unknown'
        ) AS name,
        SUM(si.total_price) AS revenue
      FROM sales s
      JOIN sale_items si
        ON si.sale_id = s.id
      LEFT JOIN appointments a
        ON a.id = s.appointment_id
      LEFT JOIN LATERAL (
        SELECT
          NULLIF(TRIM(COALESCE(src.staff_name, '')), '') AS staff_name,
          NULLIF(src.staff_id, '')::uuid AS staff_id
        FROM (
          SELECT
            svc.value->>'staff_name' AS staff_name,
            svc.value->>'staff_id' AS staff_id,
            svc.value->>'service_id' AS item_id,
            svc.value->>'name' AS item_name,
            COALESCE(NULLIF(svc.value->>'quantity', '')::int, NULLIF(svc.value->>'qty', '')::int, 1) AS item_qty,
            COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0) AS item_price
          FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)

          UNION ALL

          SELECT
            pkg.value->>'staff_name' AS staff_name,
            pkg.value->>'staff_id' AS staff_id,
            pkg.value->>'package_id' AS item_id,
            pkg.value->>'name' AS item_name,
            COALESCE(NULLIF(pkg.value->>'quantity', '')::int, NULLIF(pkg.value->>'qty', '')::int, 1) AS item_qty,
            COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0) AS item_price
          FROM jsonb_array_elements(COALESCE(a.package_items, '[]'::jsonb)) AS pkg(value)
        ) src
        WHERE
          src.item_id = si.item_id::text
          OR (
            LOWER(COALESCE(src.item_name, '')) = LOWER(COALESCE(si.name, ''))
            AND src.item_qty = COALESCE(si.quantity, 1)
            AND src.item_price = COALESCE(si.unit_price::numeric, 0)
          )
        LIMIT 1
      ) line_match
        ON TRUE
      LEFT JOIN staff st
        ON st.id = COALESCE(si.staff_id, line_match.staff_id, a.staff_id, s.staff_id)
      WHERE ${where.join(" AND ")}
      GROUP BY
        COALESCE(
          NULLIF(line_match.staff_name, ''),
          NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''),
          'Unknown'
        )
      ORDER BY revenue DESC
      LIMIT 1
      `,
      values
    ),

    pool.query(
      `
      SELECT
        si.name,
        SUM(si.total_price) AS revenue
      FROM sales s
      JOIN sale_items si
        ON si.sale_id = s.id
      WHERE ${where.join(" AND ")}
      GROUP BY si.name
      ORDER BY revenue DESC
      LIMIT 1
      `,
      values
    ),

    pool.query(
      `
      SELECT
        TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'FMDay') AS day_name,
        SUM(si.total_price) AS revenue
      FROM sales s
      JOIN sale_items si
        ON si.sale_id = s.id
      WHERE ${where.join(" AND ")}
      GROUP BY day_name
      ORDER BY revenue DESC
      LIMIT 1
      `,
      values
    ),

    pool.query(
      `
      SELECT
        COALESCE(
          SUM(si.total_price) /
          NULLIF(COUNT(DISTINCT s.client_id), 0),
          0
        ) AS avg_spend
      FROM sales s
      JOIN sale_items si
        ON si.sale_id = s.id
      WHERE ${where.join(" AND ")}
      `,
      values
    ),
  ]);

  // Revenue Growth
  let growth = 0;

  if (filters.from && filters.to) {
    const current = await pool.query(
      `
      SELECT COALESCE(SUM(si.total_price), 0) AS revenue
      FROM sales s
      JOIN sale_items si
        ON si.sale_id = s.id
      WHERE ${where.join(" AND ")}
      `,
      values
    );

    const diff =
      (new Date(filters.to).getTime() -
        new Date(filters.from).getTime()) /
        86400000 +
      1;

    const previous = await pool.query(
      `
      SELECT COALESCE(SUM(si.total_price), 0) AS revenue
      FROM sales s
      JOIN sale_items si
        ON si.sale_id = s.id
      WHERE
        s.salon_id = $1
        AND s.status = 'completed'
        AND si.item_type = 'service'
        AND DATE(s.created_at)
          BETWEEN ($2::date - (${diff})::int)
          AND ($2::date - 1)
      `,
      [salonId, filters.from]
    );

    const currentRevenue = Number(current.rows[0].revenue);
    const previousRevenue = Number(previous.rows[0].revenue);

    if (previousRevenue > 0) {
      growth =
        ((currentRevenue - previousRevenue) / previousRevenue) * 100;
    }
  }

  return {
    top_staff: topStaff.rows[0]?.name ?? "-",
    top_service: topService.rows[0]?.name ?? "-",
    highest_revenue_day: revenueDay.rows[0]?.day_name?.trim() ?? "-",
    avg_guest_spend: Number(avgSpend.rows[0]?.avg_spend ?? 0),
    growth: Number(growth.toFixed(2)),
  };
},

async getServiceRevenueTable(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];
  const saleWhere = [
    "s.salon_id = $1",
    "s.status IN ('draft', 'completed', 'cancelled', 'refunded')",
    "si.item_type = 'service'",
  ];
  const appointmentWhere = [
    "a.salon_id = $1",
    "NOT EXISTS (SELECT 1 FROM sales sx WHERE sx.appointment_id = a.id)",
  ];

  let index = 2;

  if (filters.from) {
    saleWhere.push(`DATE(s.created_at) >= $${index}`);
    appointmentWhere.push(`DATE(a.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    saleWhere.push(`DATE(s.created_at) <= $${index}`);
    appointmentWhere.push(`DATE(a.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  // tax_amount below reads si.tax_amount (this row's own GST, see
  // pricing.engine.ts's per-row allocation) — it used to read s.tax_amount
  // (the WHOLE sale's tax), which duplicated the full bill's tax onto every
  // sibling item row, overstating total tax whenever a sale had more than
  // one item and its rows were summed together.
  const { rows } = await pool.query(
    `
    WITH sale_rows AS (
      SELECT
        s.id,
        s.invoice_number,
        c.full_name AS client_name,
        si.name AS service_name,
        COALESCE(
          NULLIF(line_match.staff_name, ''),
          NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''),
          ''
        ) AS staff_name,
        COALESCE(si.quantity, 1) AS quantity,
        COALESCE(si.unit_price::numeric, 0) AS unit_price,
        COALESCE(si.discount_amount::numeric, 0) AS discount,
        COALESCE(si.tax_amount::numeric, 0) AS tax_amount,
        COALESCE(si.total_price::numeric, 0) AS total_amount,
        s.payment_method,
        CASE
          WHEN a.id IS NOT NULL THEN COALESCE(apay.payment_status, 'unpaid')
          WHEN s.status = 'completed' THEN 'paid'
          WHEN s.status = 'refunded' THEN 'refunded'
          ELSE 'unpaid'
        END AS payment_status,
        COALESCE(a.status::text, s.status) AS status,
        CASE
          WHEN line_match.matched = 1 THEN 'Appointment'
          ELSE 'Sale'
        END AS source,
        s.created_at AS service_date
      FROM sales s
      JOIN sale_items si
        ON si.sale_id = s.id
      LEFT JOIN clients c
        ON c.id = s.client_id
      LEFT JOIN appointments a
        ON a.id = s.appointment_id
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN COUNT(*) FILTER (WHERE p.status IN ('completed', 'partial', 'refunded')) > 0
              AND COALESCE(
                MAX(p.due_amount) FILTER (
                  WHERE p.created_at = (
                    SELECT MAX(p2.created_at)
                    FROM payments p2
                    WHERE p2.appointment_id = a.id
                  )
                ),
                1
              ) = 0
            THEN 'paid'
            WHEN COUNT(*) FILTER (WHERE p.status IN ('completed', 'partial', 'refunded')) > 0
            THEN 'partial'
            ELSE 'unpaid'
          END AS payment_status
        FROM payments p
        WHERE p.appointment_id = a.id
      ) apay
        ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          1 AS matched,
          NULLIF(TRIM(COALESCE(src.staff_name, '')), '') AS staff_name,
          NULLIF(src.staff_id, '')::uuid AS staff_id
        FROM (
          SELECT
            svc.value->>'staff_name' AS staff_name,
            svc.value->>'staff_id' AS staff_id,
            svc.value->>'service_id' AS item_id,
            svc.value->>'name' AS item_name,
            COALESCE(NULLIF(svc.value->>'quantity', '')::int, NULLIF(svc.value->>'qty', '')::int, 1) AS item_qty,
            COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0) AS item_price
          FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)

          UNION ALL

          SELECT
            pkg.value->>'staff_name' AS staff_name,
            pkg.value->>'staff_id' AS staff_id,
            pkg.value->>'package_id' AS item_id,
            pkg.value->>'name' AS item_name,
            COALESCE(NULLIF(pkg.value->>'quantity', '')::int, NULLIF(pkg.value->>'qty', '')::int, 1) AS item_qty,
            COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0) AS item_price
          FROM jsonb_array_elements(COALESCE(a.package_items, '[]'::jsonb)) AS pkg(value)
        ) src
        WHERE
          src.item_id = si.item_id::text
          OR (
            LOWER(COALESCE(src.item_name, '')) = LOWER(COALESCE(si.name, ''))
            AND src.item_qty = COALESCE(si.quantity, 1)
            AND src.item_price = COALESCE(si.unit_price::numeric, 0)
          )
        LIMIT 1
      ) line_match
        ON TRUE
      LEFT JOIN staff st
        ON st.id = COALESCE(si.staff_id, line_match.staff_id, a.staff_id, s.staff_id)
      WHERE ${saleWhere.join(" AND ")}
    ),
    appointment_rows AS (
      SELECT
        a.id,
        NULL::text AS invoice_number,
        c.full_name AS client_name,
        src.item_name AS service_name,
        COALESCE(
          NULLIF(TRIM(COALESCE(src.staff_name, '')), ''),
          NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''),
          ''
        ) AS staff_name,
        src.item_qty AS quantity,
        src.item_price AS unit_price,
        0::numeric AS discount,
        0::numeric AS tax_amount,
        COALESCE(src.item_total, src.item_price * src.item_qty, 0) AS total_amount,
        apay.payment_method,
        COALESCE(apay.payment_status, 'unpaid') AS payment_status,
        a.status::text AS status,
        'Appointment' AS source,
        a.created_at AS service_date
      FROM appointments a
      LEFT JOIN clients c
        ON c.id = a.client_id
      LEFT JOIN LATERAL (
        SELECT
          src.item_name,
          src.staff_name,
          src.staff_id,
          src.item_qty,
          src.item_price,
          src.item_total
        FROM (
          SELECT
            svc.value->>'name' AS item_name,
            svc.value->>'staff_name' AS staff_name,
            NULLIF(svc.value->>'staff_id', '')::uuid AS staff_id,
            COALESCE(NULLIF(svc.value->>'quantity', '')::int, NULLIF(svc.value->>'qty', '')::int, 1) AS item_qty,
            COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0) AS item_price,
            COALESCE(NULLIF(svc.value->>'total', '')::numeric, COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0) * COALESCE(NULLIF(svc.value->>'quantity', '')::int, NULLIF(svc.value->>'qty', '')::int, 1)) AS item_total
          FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)

          UNION ALL

          SELECT
            pkg.value->>'name' AS item_name,
            pkg.value->>'staff_name' AS staff_name,
            NULLIF(pkg.value->>'staff_id', '')::uuid AS staff_id,
            COALESCE(NULLIF(pkg.value->>'quantity', '')::int, NULLIF(pkg.value->>'qty', '')::int, 1) AS item_qty,
            COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0) AS item_price,
            COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0) * COALESCE(NULLIF(pkg.value->>'quantity', '')::int, NULLIF(pkg.value->>'qty', '')::int, 1) AS item_total
          FROM jsonb_array_elements(COALESCE(a.package_items, '[]'::jsonb)) AS pkg(value)
        ) src
      ) src
        ON TRUE
      LEFT JOIN staff st
        ON st.id = COALESCE(src.staff_id, a.staff_id)
      LEFT JOIN LATERAL (
        SELECT
          CASE
            WHEN COUNT(*) FILTER (WHERE p.status IN ('completed', 'partial', 'refunded')) > 0
              AND COALESCE(
                MAX(p.due_amount) FILTER (
                  WHERE p.created_at = (
                    SELECT MAX(p2.created_at)
                    FROM payments p2
                    WHERE p2.appointment_id = a.id
                  )
                ),
                1
              ) = 0
            THEN 'paid'
            WHEN COUNT(*) FILTER (WHERE p.status IN ('completed', 'partial', 'refunded')) > 0
            THEN 'partial'
            ELSE 'unpaid'
          END AS payment_status,
          MAX(p.payment_method) FILTER (
            WHERE p.created_at = (
              SELECT MAX(p2.created_at)
              FROM payments p2
              WHERE p2.appointment_id = a.id
            )
          ) AS payment_method
        FROM payments p
        WHERE p.appointment_id = a.id
      ) apay
        ON TRUE
      WHERE
        ${appointmentWhere.join(" AND ")}
        AND src.item_name IS NOT NULL
    )
    SELECT *
    FROM (
      SELECT * FROM sale_rows
      UNION ALL
      SELECT * FROM appointment_rows
    ) service_rows
    ORDER BY service_date DESC
    `,
    values
  );

  return rows.map((row) => ({
    id: row.id,
    invoice_number: row.invoice_number,
    client_name: row.client_name,
    service_name: row.service_name,
    staff_name: row.staff_name,
    quantity: Number(row.quantity),
    unit_price: Number(row.unit_price),
    discount: Number(row.discount),
    tax_amount: Number(row.tax_amount),
    total_amount: Number(row.total_amount),
    payment_method: row.payment_method,
    payment_status: row.payment_status,
    status: row.status,
    source: row.source,
    service_date: row.service_date,
  }));
},

async getStaffRevenue(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "si.item_type = 'service'",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(
        MAX(NULLIF(line_match.staff_name, '')),
        NULLIF(
          MAX(
            TRIM(
              CONCAT(
                COALESCE(st.first_name, ''),
                ' ',
                COALESCE(st.last_name, '')
              )
            )
          ),
          ''
        ),
        'Unknown'
      ) AS staff_name,

      ROUND(SUM(si.total_price), 2) AS revenue,
      SUM(si.quantity) AS services,
      COUNT(DISTINCT s.client_id) AS customers

    FROM sales s

    JOIN sale_items si
      ON si.sale_id = s.id

    LEFT JOIN appointments a
      ON a.id = s.appointment_id

    LEFT JOIN LATERAL (
      SELECT
        NULLIF(TRIM(COALESCE(src.staff_name, '')), '') AS staff_name,
        NULLIF(src.staff_id, '')::uuid AS staff_id
      FROM (
        SELECT
          svc.value->>'staff_name' AS staff_name,
          svc.value->>'staff_id' AS staff_id,
          svc.value->>'service_id' AS item_id,
          svc.value->>'name' AS item_name,
          COALESCE(NULLIF(svc.value->>'quantity', '')::int, NULLIF(svc.value->>'qty', '')::int, 1) AS item_qty,
          COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0) AS item_price
        FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)

        UNION ALL

        SELECT
          pkg.value->>'staff_name' AS staff_name,
          pkg.value->>'staff_id' AS staff_id,
          pkg.value->>'package_id' AS item_id,
          pkg.value->>'name' AS item_name,
          COALESCE(NULLIF(pkg.value->>'quantity', '')::int, NULLIF(pkg.value->>'qty', '')::int, 1) AS item_qty,
          COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0) AS item_price
        FROM jsonb_array_elements(COALESCE(a.package_items, '[]'::jsonb)) AS pkg(value)
      ) src
      WHERE
        src.item_id = si.item_id::text
        OR (
          LOWER(COALESCE(src.item_name, '')) = LOWER(COALESCE(si.name, ''))
          AND src.item_qty = COALESCE(si.quantity, 1)
          AND src.item_price = COALESCE(si.unit_price::numeric, 0)
        )
      LIMIT 1
    ) line_match
      ON TRUE

    LEFT JOIN staff st
      ON st.id = COALESCE(si.staff_id, line_match.staff_id, a.staff_id, s.staff_id)

    WHERE ${where.join(" AND ")}

    GROUP BY COALESCE(NULLIF(line_match.staff_name, ''), 'Unknown')

    ORDER BY revenue DESC;
    `,
    values
  );

  return rows.map((row) => ({
    name: row.staff_name,
    revenue: Number(row.revenue),
    services: Number(row.services),
    customers: Number(row.customers),
  }));
},

async getSalesSummaryTable(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
    search?: string;
    page?: number;
    limit?: number;
    sort_by?: string;
    sort_order?: "asc" | "desc";
  }
): Promise<SalesSummaryTableData> {
  const page = 1;

  const values: any[] = [salonId];
  const saleWhere = [
    "s.salon_id = $1",
    "s.status IN ('draft', 'completed', 'cancelled', 'refunded')",
  ];
  const appointmentWhere = [
    "a.salon_id = $1",
    "NOT EXISTS (SELECT 1 FROM sales sx WHERE sx.appointment_id = a.id)",
    "LOWER(COALESCE(a.status::text, '')) NOT IN ('cancelled', 'no-show')",
  ];

  let index = 2;

  if (filters.from) {
    saleWhere.push(`DATE(s.created_at) >= $${index}`);
    appointmentWhere.push(`DATE(a.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    saleWhere.push(`DATE(s.created_at) <= $${index}`);
    appointmentWhere.push(`DATE(a.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  let searchClause = "";
  if (filters.search?.trim()) {
    searchClause = `
      WHERE
        COALESCE(fr.invoice_no, '') ILIKE $${index}
        OR COALESCE(fr.customer_name, '') ILIKE $${index}
        OR COALESCE(fr.mobile, '') ILIKE $${index}
        OR COALESCE(fr.staff_name, '') ILIKE $${index}
        OR COALESCE(fr.payment_method, '') ILIKE $${index}
        OR COALESCE(fr.payment_status, '') ILIKE $${index}
        OR COALESCE(fr.sale_status, '') ILIKE $${index}
        OR COALESCE(fr.services, '') ILIKE $${index}
        OR COALESCE(fr.products, '') ILIKE $${index}
        OR COALESCE(fr.packages, '') ILIKE $${index}
        OR COALESCE(fr.memberships, '') ILIKE $${index}
        OR COALESCE(fr.gift_cards, '') ILIKE $${index}
        OR COALESCE(fr.other_items, '') ILIKE $${index}
    `;
    values.push(`%${filters.search.trim()}%`);
    index++;
  }

  const sortMap: Record<string, string> = {
    invoiceNo: "invoice_no",
    date: "created_at",
    customerName: "customer_name",
    mobile: "mobile",
    staffName: "staff_name",
    paymentMethod: "payment_method",
    paymentStatus: "payment_status",
    saleStatus: "sale_status",
    grossAmount: "gross_amount",
    discount: "discount",
    tax: "tax",
    tip: "tip",
    netAmount: "net_amount",
    collectedAmount: "collected_amount",
    pendingAmount: "pending_amount",
    totalQuantity: "total_quantity",
  };

  const sortColumn = sortMap[filters.sort_by ?? ""] ?? "created_at";
  const sortOrder =
    String(filters.sort_order || "desc").toLowerCase() === "asc"
      ? "ASC"
      : "DESC";

  const baseQuery = `
    ${SALES_SUMMARY_ITEM_CTES},
    appointment_payment AS (
      SELECT
        p.appointment_id,
        COALESCE(
          SUM(COALESCE(p.paid_amount, 0)::numeric)
            FILTER (WHERE p.status IN ('completed', 'partial', 'refunded')),
          0
        ) AS collected_amount,
        COALESCE(
          MAX(COALESCE(p.due_amount, 0)::numeric) FILTER (
            WHERE p.created_at = (
              SELECT MAX(p2.created_at)
              FROM payments p2
              WHERE p2.appointment_id = p.appointment_id
            )
          ),
          0
        ) AS pending_amount,
        COALESCE(
          MAX(COALESCE(p.due_amount, 0)::numeric) FILTER (
            WHERE p.created_at = (
              SELECT MAX(p2.created_at)
              FROM payments p2
              WHERE p2.appointment_id = p.appointment_id
            )
          ),
          0
        ) AS latest_due,
        COALESCE(
          MAX(p.payment_method) FILTER (
            WHERE p.created_at = (
              SELECT MAX(p2.created_at)
              FROM payments p2
              WHERE p2.appointment_id = p.appointment_id
            )
          ),
          ''
        ) AS payment_method,
        COALESCE(
          MAX(p.status) FILTER (
            WHERE p.created_at = (
              SELECT MAX(p2.created_at)
              FROM payments p2
              WHERE p2.appointment_id = p.appointment_id
            )
          ),
          ''
        ) AS latest_status
      FROM payments p
      WHERE p.appointment_id IS NOT NULL
      GROUP BY p.appointment_id
    ),
    invoice_staff AS (
      SELECT
        staff_src.sale_id,
        COALESCE(
          STRING_AGG(staff_src.staff_name, ', ' ORDER BY staff_src.staff_name),
          ''
        ) AS staff_name
      FROM (
        SELECT DISTINCT
          ni.sale_id,
          COALESCE(
            NULLIF(TRIM(COALESCE(line_match.staff_name, '')), ''),
            NULLIF(
              TRIM(
                CONCAT(
                  COALESCE(st.first_name, ''),
                  ' ',
                  COALESCE(st.last_name, '')
                )
              ),
              ''
            ),
            'Unknown'
          ) AS staff_name
        FROM normalized_items ni
        JOIN sales s
          ON s.id = ni.sale_id
        LEFT JOIN appointments a
          ON a.id = s.appointment_id
        LEFT JOIN LATERAL (
          SELECT
            NULLIF(TRIM(COALESCE(src.staff_name, '')), '') AS staff_name,
            NULLIF(src.staff_id, '')::uuid AS staff_id
          FROM (
            SELECT
              svc.value->>'staff_name' AS staff_name,
              svc.value->>'staff_id' AS staff_id,
              svc.value->>'service_id' AS item_id,
              svc.value->>'name' AS item_name,
              COALESCE(NULLIF(svc.value->>'quantity', '')::int, NULLIF(svc.value->>'qty', '')::int, 1) AS item_qty,
              COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0) AS item_price
            FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)

            UNION ALL

            SELECT
              pkg.value->>'staff_name' AS staff_name,
              pkg.value->>'staff_id' AS staff_id,
              pkg.value->>'package_id' AS item_id,
              pkg.value->>'name' AS item_name,
              COALESCE(NULLIF(pkg.value->>'quantity', '')::int, NULLIF(pkg.value->>'qty', '')::int, 1) AS item_qty,
              COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0) AS item_price
            FROM jsonb_array_elements(COALESCE(a.package_items, '[]'::jsonb)) AS pkg(value)

            UNION ALL

            SELECT
              prod.value->>'staff_name' AS staff_name,
              prod.value->>'staff_id' AS staff_id,
              prod.value->>'product_id' AS item_id,
              prod.value->>'name' AS item_name,
              COALESCE(NULLIF(prod.value->>'quantity', '')::int, NULLIF(prod.value->>'qty', '')::int, 1) AS item_qty,
              COALESCE(NULLIF(prod.value->>'price', '')::numeric, 0) AS item_price
            FROM jsonb_array_elements(COALESCE(a.product_items, '[]'::jsonb)) AS prod(value)

            UNION ALL

            SELECT
              mem.value->>'staff_name' AS staff_name,
              mem.value->>'staff_id' AS staff_id,
              mem.value->>'membership_id' AS item_id,
              mem.value->>'name' AS item_name,
              COALESCE(NULLIF(mem.value->>'quantity', '')::int, NULLIF(mem.value->>'qty', '')::int, 1) AS item_qty,
              COALESCE(NULLIF(mem.value->>'price', '')::numeric, 0) AS item_price
            FROM jsonb_array_elements(COALESCE(a.membership_items, '[]'::jsonb)) AS mem(value)
          ) src
          WHERE
            src.item_id = ni.item_id
            OR (
              LOWER(COALESCE(src.item_name, '')) = LOWER(COALESCE(ni.name, ''))
              AND src.item_qty = COALESCE(ni.quantity, 1)
              AND src.item_price = COALESCE(ni.unit_price, 0)
            )
          LIMIT 1
        ) line_match
          ON TRUE
        LEFT JOIN staff st
          ON st.id = COALESCE(
            ni.item_staff_id,
            line_match.staff_id,
            a.staff_id,
            s.staff_id
          )
      ) staff_src
      GROUP BY staff_src.sale_id
    ),
    invoice_items AS (
      SELECT
        item_rows.sale_id,
        COALESCE(
          STRING_AGG(item_rows.item_label, ', ' ORDER BY item_rows.display_order, item_rows.item_label)
            FILTER (WHERE item_rows.item_type = 'service'),
          ''
        ) AS services,
        COALESCE(
          STRING_AGG(item_rows.item_label, ', ' ORDER BY item_rows.display_order, item_rows.item_label)
            FILTER (WHERE item_rows.item_type = 'product'),
          ''
        ) AS products,
        COALESCE(
          STRING_AGG(item_rows.item_label, ', ' ORDER BY item_rows.display_order, item_rows.item_label)
            FILTER (WHERE item_rows.item_type = 'package'),
          ''
        ) AS packages,
        COALESCE(
          STRING_AGG(item_rows.item_label, ', ' ORDER BY item_rows.display_order, item_rows.item_label)
            FILTER (WHERE item_rows.item_type = 'membership'),
          ''
        ) AS memberships,
        COALESCE(
          STRING_AGG(item_rows.item_label, ', ' ORDER BY item_rows.display_order, item_rows.item_label)
            FILTER (WHERE item_rows.item_type = 'gift_card'),
          ''
        ) AS gift_cards,
        COALESCE(
          STRING_AGG(item_rows.item_label, ', ' ORDER BY item_rows.display_order, item_rows.item_label)
            FILTER (WHERE item_rows.item_type NOT IN ('service', 'product', 'package', 'membership', 'gift_card')),
          ''
        ) AS other_items,
        COALESCE(SUM(item_rows.quantity), 0) AS total_quantity,
        COALESCE(
          JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'itemType', item_rows.item_type,
              'itemId', item_rows.item_id,
              'name', item_rows.name,
              'quantity', item_rows.quantity,
              'unitPrice', item_rows.unit_price,
              'discount', item_rows.discount_amount,
              'total', item_rows.total_price,
              'staffName', item_rows.staff_name
            )
            ORDER BY item_rows.display_order, item_rows.name
          ),
          '[]'::jsonb
        ) AS item_details
      FROM (
        SELECT
          ni.sale_id,
          ni.item_type,
          ni.item_id,
          ni.name,
          ni.quantity,
          ni.unit_price,
          ni.discount_amount,
          ni.total_price,
          CONCAT(ni.name, ' x', ni.quantity) AS item_label,
          CASE
            WHEN ni.item_type = 'service' THEN 1
            WHEN ni.item_type = 'product' THEN 2
            WHEN ni.item_type = 'package' THEN 3
            WHEN ni.item_type = 'membership' THEN 4
            WHEN ni.item_type = 'gift_card' THEN 5
            ELSE 6
          END AS display_order,
          COALESCE(
            NULLIF(TRIM(COALESCE(line_match.staff_name, '')), ''),
            NULLIF(
              TRIM(
                CONCAT(
                  COALESCE(st.first_name, ''),
                  ' ',
                  COALESCE(st.last_name, '')
                )
              ),
              ''
            ),
            'Unknown'
          ) AS staff_name
        FROM normalized_items ni
        JOIN sales s
          ON s.id = ni.sale_id
        LEFT JOIN appointments a
          ON a.id = s.appointment_id
        LEFT JOIN LATERAL (
          SELECT
            NULLIF(TRIM(COALESCE(src.staff_name, '')), '') AS staff_name,
            NULLIF(src.staff_id, '')::uuid AS staff_id
          FROM (
            SELECT
              svc.value->>'staff_name' AS staff_name,
              svc.value->>'staff_id' AS staff_id,
              svc.value->>'service_id' AS item_id,
              svc.value->>'name' AS item_name,
              COALESCE(NULLIF(svc.value->>'quantity', '')::int, NULLIF(svc.value->>'qty', '')::int, 1) AS item_qty,
              COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0) AS item_price
            FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)

            UNION ALL

            SELECT
              pkg.value->>'staff_name' AS staff_name,
              pkg.value->>'staff_id' AS staff_id,
              pkg.value->>'package_id' AS item_id,
              pkg.value->>'name' AS item_name,
              COALESCE(NULLIF(pkg.value->>'quantity', '')::int, NULLIF(pkg.value->>'qty', '')::int, 1) AS item_qty,
              COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0) AS item_price
            FROM jsonb_array_elements(COALESCE(a.package_items, '[]'::jsonb)) AS pkg(value)

            UNION ALL

            SELECT
              prod.value->>'staff_name' AS staff_name,
              prod.value->>'staff_id' AS staff_id,
              prod.value->>'product_id' AS item_id,
              prod.value->>'name' AS item_name,
              COALESCE(NULLIF(prod.value->>'quantity', '')::int, NULLIF(prod.value->>'qty', '')::int, 1) AS item_qty,
              COALESCE(NULLIF(prod.value->>'price', '')::numeric, 0) AS item_price
            FROM jsonb_array_elements(COALESCE(a.product_items, '[]'::jsonb)) AS prod(value)

            UNION ALL

            SELECT
              mem.value->>'staff_name' AS staff_name,
              mem.value->>'staff_id' AS staff_id,
              mem.value->>'membership_id' AS item_id,
              mem.value->>'name' AS item_name,
              COALESCE(NULLIF(mem.value->>'quantity', '')::int, NULLIF(mem.value->>'qty', '')::int, 1) AS item_qty,
              COALESCE(NULLIF(mem.value->>'price', '')::numeric, 0) AS item_price
            FROM jsonb_array_elements(COALESCE(a.membership_items, '[]'::jsonb)) AS mem(value)
          ) src
          WHERE
            src.item_id = ni.item_id
            OR (
              LOWER(COALESCE(src.item_name, '')) = LOWER(COALESCE(ni.name, ''))
              AND src.item_qty = COALESCE(ni.quantity, 1)
              AND src.item_price = COALESCE(ni.unit_price, 0)
            )
          LIMIT 1
        ) line_match
          ON TRUE
        LEFT JOIN staff st
          ON st.id = COALESCE(
            ni.item_staff_id,
            line_match.staff_id,
            a.staff_id,
            s.staff_id
          )
      ) item_rows
      GROUP BY item_rows.sale_id
    ),
    appointment_items AS (
      SELECT
        item_rows.appointment_id,
        COALESCE(
          STRING_AGG(item_rows.item_label, ', ' ORDER BY item_rows.display_order, item_rows.item_label)
            FILTER (WHERE item_rows.item_type = 'service'),
          ''
        ) AS services,
        COALESCE(
          STRING_AGG(item_rows.item_label, ', ' ORDER BY item_rows.display_order, item_rows.item_label)
            FILTER (WHERE item_rows.item_type = 'product'),
          ''
        ) AS products,
        COALESCE(
          STRING_AGG(item_rows.item_label, ', ' ORDER BY item_rows.display_order, item_rows.item_label)
            FILTER (WHERE item_rows.item_type = 'package'),
          ''
        ) AS packages,
        COALESCE(
          STRING_AGG(item_rows.item_label, ', ' ORDER BY item_rows.display_order, item_rows.item_label)
            FILTER (WHERE item_rows.item_type = 'membership'),
          ''
        ) AS memberships,
        ''::text AS gift_cards,
        ''::text AS other_items,
        COALESCE(SUM(item_rows.quantity), 0) AS total_quantity,
        COALESCE(SUM(item_rows.line_total), 0) AS gross_amount,
        COALESCE(
          JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'itemType', item_rows.item_type,
              'itemId', item_rows.item_id,
              'name', item_rows.name,
              'quantity', item_rows.quantity,
              'unitPrice', item_rows.unit_price,
              'discount', 0,
              'total', item_rows.line_total,
              'staffName', item_rows.staff_name
            )
            ORDER BY item_rows.display_order, item_rows.name
          ),
          '[]'::jsonb
        ) AS item_details
      FROM (
        SELECT
          a.id AS appointment_id,
          'service'::text AS item_type,
          COALESCE(NULLIF(svc.value->>'service_id', ''), LOWER(COALESCE(svc.value->>'name', 'service'))) AS item_id,
          COALESCE(NULLIF(svc.value->>'name', ''), 'Service') AS name,
          COALESCE(NULLIF(svc.value->>'quantity', '')::int, NULLIF(svc.value->>'qty', '')::int, 1) AS quantity,
          COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0) AS unit_price,
          COALESCE(
            NULLIF(svc.value->>'total', '')::numeric,
            COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0)
            * COALESCE(NULLIF(svc.value->>'quantity', '')::int, NULLIF(svc.value->>'qty', '')::int, 1)
          ) AS line_total,
          CONCAT(
            COALESCE(NULLIF(svc.value->>'name', ''), 'Service'),
            ' x',
            COALESCE(NULLIF(svc.value->>'quantity', '')::int, NULLIF(svc.value->>'qty', '')::int, 1)
          ) AS item_label,
          COALESCE(NULLIF(TRIM(COALESCE(svc.value->>'staff_name', '')), ''), 'Unknown') AS staff_name,
          1 AS display_order
        FROM appointments a
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)

        UNION ALL

        SELECT
          a.id AS appointment_id,
          'product'::text AS item_type,
          COALESCE(NULLIF(prod.value->>'product_id', ''), LOWER(COALESCE(prod.value->>'name', 'product'))) AS item_id,
          COALESCE(NULLIF(prod.value->>'name', ''), 'Product') AS name,
          COALESCE(NULLIF(prod.value->>'quantity', '')::int, NULLIF(prod.value->>'qty', '')::int, 1) AS quantity,
          COALESCE(NULLIF(prod.value->>'price', '')::numeric, 0) AS unit_price,
          COALESCE(NULLIF(prod.value->>'price', '')::numeric, 0)
            * COALESCE(NULLIF(prod.value->>'quantity', '')::int, NULLIF(prod.value->>'qty', '')::int, 1) AS line_total,
          CONCAT(
            COALESCE(NULLIF(prod.value->>'name', ''), 'Product'),
            ' x',
            COALESCE(NULLIF(prod.value->>'quantity', '')::int, NULLIF(prod.value->>'qty', '')::int, 1)
          ) AS item_label,
          COALESCE(NULLIF(TRIM(COALESCE(prod.value->>'staff_name', '')), ''), 'Unknown') AS staff_name,
          2 AS display_order
        FROM appointments a
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.product_items, '[]'::jsonb)) AS prod(value)

        UNION ALL

        SELECT
          a.id AS appointment_id,
          'package'::text AS item_type,
          COALESCE(NULLIF(pkg.value->>'package_id', ''), LOWER(COALESCE(pkg.value->>'name', 'package'))) AS item_id,
          COALESCE(NULLIF(pkg.value->>'name', ''), 'Package') AS name,
          COALESCE(NULLIF(pkg.value->>'quantity', '')::int, NULLIF(pkg.value->>'qty', '')::int, 1) AS quantity,
          COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0) AS unit_price,
          COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0)
            * COALESCE(NULLIF(pkg.value->>'quantity', '')::int, NULLIF(pkg.value->>'qty', '')::int, 1) AS line_total,
          CONCAT(
            COALESCE(NULLIF(pkg.value->>'name', ''), 'Package'),
            ' x',
            COALESCE(NULLIF(pkg.value->>'quantity', '')::int, NULLIF(pkg.value->>'qty', '')::int, 1)
          ) AS item_label,
          COALESCE(NULLIF(TRIM(COALESCE(pkg.value->>'staff_name', '')), ''), 'Unknown') AS staff_name,
          3 AS display_order
        FROM appointments a
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.package_items, '[]'::jsonb)) AS pkg(value)

        UNION ALL

        SELECT
          a.id AS appointment_id,
          'membership'::text AS item_type,
          COALESCE(NULLIF(mem.value->>'membership_id', ''), LOWER(COALESCE(mem.value->>'name', 'membership'))) AS item_id,
          COALESCE(NULLIF(mem.value->>'name', ''), 'Membership') AS name,
          COALESCE(NULLIF(mem.value->>'quantity', '')::int, NULLIF(mem.value->>'qty', '')::int, 1) AS quantity,
          COALESCE(NULLIF(mem.value->>'price', '')::numeric, 0) AS unit_price,
          COALESCE(NULLIF(mem.value->>'price', '')::numeric, 0)
            * COALESCE(NULLIF(mem.value->>'quantity', '')::int, NULLIF(mem.value->>'qty', '')::int, 1) AS line_total,
          CONCAT(
            COALESCE(NULLIF(mem.value->>'name', ''), 'Membership'),
            ' x',
            COALESCE(NULLIF(mem.value->>'quantity', '')::int, NULLIF(mem.value->>'qty', '')::int, 1)
          ) AS item_label,
          COALESCE(NULLIF(TRIM(COALESCE(mem.value->>'staff_name', '')), ''), 'Unknown') AS staff_name,
          4 AS display_order
        FROM appointments a
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.membership_items, '[]'::jsonb)) AS mem(value)
      ) item_rows
      GROUP BY item_rows.appointment_id
    ),
    sale_rows AS (
      SELECT
        s.id AS sale_id,
        NULLIF(s.invoice_number, '') AS invoice_no,
        s.created_at,
        COALESCE(c.full_name, 'Walk-in Client') AS customer_name,
        COALESCE(c.phone_number, '') AS mobile,
        COALESCE(stf.staff_name, 'Unknown') AS staff_name,
        UPPER(
          COALESCE(
            NULLIF(ap.payment_method, ''),
            NULLIF(s.payment_method, ''),
            'N/A'
          )
        ) AS payment_method,
        CASE
          WHEN s.status = 'refunded' THEN 'Refunded'
          WHEN s.status = 'cancelled' THEN 'Cancelled'
          WHEN s.appointment_id IS NOT NULL AND COALESCE(ap.pending_amount, 0) > 0 AND COALESCE(ap.collected_amount, 0) > 0 THEN 'Partial'
          WHEN s.appointment_id IS NOT NULL AND COALESCE(ap.pending_amount, 0) > 0 THEN 'Pending'
          WHEN s.status = 'completed' THEN 'Paid'
          WHEN s.status = 'draft' THEN 'Pending'
          ELSE INITCAP(COALESCE(s.status::text, 'pending'))
        END AS payment_status,
        INITCAP(COALESCE(s.status::text, 'draft')) AS sale_status,
        COALESCE(s.subtotal::numeric, 0) AS gross_amount,
        COALESCE(s.discount_amount::numeric, 0) AS discount,
        COALESCE(s.tax_amount::numeric, 0) AS tax,
        COALESCE(s.tip_amount::numeric, 0) AS tip,
        COALESCE(s.total_amount::numeric, 0) AS net_amount,
        CASE
          WHEN s.appointment_id IS NOT NULL AND COALESCE(ap.collected_amount, 0) > 0
          THEN COALESCE(ap.collected_amount, 0)
          WHEN s.status = 'completed'
          THEN COALESCE(s.total_amount::numeric, 0)
          ELSE 0
        END AS collected_amount,
        CASE
          WHEN s.appointment_id IS NOT NULL
          THEN COALESCE(ap.pending_amount, 0)
          WHEN s.status = 'draft'
          THEN COALESCE(s.total_amount::numeric, 0)
          ELSE 0
        END AS pending_amount,
        COALESCE(items.total_quantity, 0) AS total_quantity,
        COALESCE(items.services, '') AS services,
        COALESCE(items.products, '') AS products,
        COALESCE(items.packages, '') AS packages,
        COALESCE(items.memberships, '') AS memberships,
        COALESCE(items.gift_cards, '') AS gift_cards,
        COALESCE(items.other_items, '') AS other_items,
        COALESCE(items.item_details, '[]'::jsonb) AS item_details,
        COALESCE(s.notes, '') AS notes
      FROM sales s
      LEFT JOIN clients c
        ON c.id = s.client_id
      LEFT JOIN appointment_payment ap
        ON ap.appointment_id = s.appointment_id
      LEFT JOIN invoice_staff stf
        ON stf.sale_id = s.id
      LEFT JOIN invoice_items items
        ON items.sale_id = s.id
      WHERE ${saleWhere.join(" AND ")}
    ),
    appointment_only_rows AS (
      SELECT
        a.id AS sale_id,
        NULL::text AS invoice_no,
        a.created_at,
        COALESCE(c.full_name, 'Walk-in Client') AS customer_name,
        COALESCE(c.phone_number, '') AS mobile,
        COALESCE(
          NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''),
          'Unknown'
        ) AS staff_name,
        UPPER(COALESCE(NULLIF(ap.payment_method, ''), 'N/A')) AS payment_method,
        CASE
          WHEN LOWER(COALESCE(ap.latest_status, '')) = 'refunded' THEN 'Refunded'
          WHEN COALESCE(ap.latest_due, 0) <= 0 AND COALESCE(ap.collected_amount, 0) > 0 THEN 'Paid'
          WHEN COALESCE(ap.collected_amount, 0) > 0 THEN 'Partial'
          ELSE 'Pending'
        END AS payment_status,
        INITCAP(COALESCE(a.status::text, 'booked')) AS sale_status,
        COALESCE(ai.gross_amount, 0) AS gross_amount,
        CASE
          WHEN LOWER(COALESCE(a.discount_type, 'flat')) = 'percentage'
          THEN ROUND(COALESCE(ai.gross_amount, 0) * COALESCE(a.discount_value::numeric, 0) / 100, 2)
          ELSE COALESCE(a.discount_value::numeric, 0)
        END AS discount,
        ROUND(
          (
            COALESCE(ai.gross_amount, 0)
            - CASE
                WHEN LOWER(COALESCE(a.discount_type, 'flat')) = 'percentage'
                THEN COALESCE(ai.gross_amount, 0) * COALESCE(a.discount_value::numeric, 0) / 100
                ELSE COALESCE(a.discount_value::numeric, 0)
              END
            + COALESCE(a.ex_charges::numeric, 0)
          ) * COALESCE(a.gst_percent::numeric, 0) / 100,
          2
        ) AS tax,
        COALESCE(a.tip_amount::numeric, 0) AS tip,
        ROUND(
          COALESCE(ai.gross_amount, 0)
          - CASE
              WHEN LOWER(COALESCE(a.discount_type, 'flat')) = 'percentage'
              THEN COALESCE(ai.gross_amount, 0) * COALESCE(a.discount_value::numeric, 0) / 100
              ELSE COALESCE(a.discount_value::numeric, 0)
            END
          + COALESCE(a.ex_charges::numeric, 0)
          + (
            (
              COALESCE(ai.gross_amount, 0)
              - CASE
                  WHEN LOWER(COALESCE(a.discount_type, 'flat')) = 'percentage'
                  THEN COALESCE(ai.gross_amount, 0) * COALESCE(a.discount_value::numeric, 0) / 100
                  ELSE COALESCE(a.discount_value::numeric, 0)
                END
              + COALESCE(a.ex_charges::numeric, 0)
            ) * COALESCE(a.gst_percent::numeric, 0) / 100
          )
          + COALESCE(a.tip_amount::numeric, 0),
          2
        ) AS net_amount,
        CASE
          WHEN LOWER(COALESCE(ap.latest_status, '')) = 'refunded' THEN 0
          WHEN COALESCE(ap.latest_due, 0) <= 0 AND COALESCE(ap.collected_amount, 0) > 0 THEN ROUND(
            COALESCE(ai.gross_amount, 0)
            - CASE
                WHEN LOWER(COALESCE(a.discount_type, 'flat')) = 'percentage'
                THEN COALESCE(ai.gross_amount, 0) * COALESCE(a.discount_value::numeric, 0) / 100
                ELSE COALESCE(a.discount_value::numeric, 0)
              END
            + COALESCE(a.ex_charges::numeric, 0)
            + (
              (
                COALESCE(ai.gross_amount, 0)
                - CASE
                    WHEN LOWER(COALESCE(a.discount_type, 'flat')) = 'percentage'
                    THEN COALESCE(ai.gross_amount, 0) * COALESCE(a.discount_value::numeric, 0) / 100
                    ELSE COALESCE(a.discount_value::numeric, 0)
                  END
                + COALESCE(a.ex_charges::numeric, 0)
              ) * COALESCE(a.gst_percent::numeric, 0) / 100
            )
            + COALESCE(a.tip_amount::numeric, 0),
            2
          )
          ELSE COALESCE(ap.collected_amount, 0)
        END AS collected_amount,
        CASE
          WHEN LOWER(COALESCE(ap.latest_status, '')) = 'refunded' THEN 0
          ELSE GREATEST(COALESCE(ap.latest_due, 0), 0)
        END AS pending_amount,
        COALESCE(ai.total_quantity, 0) AS total_quantity,
        COALESCE(ai.services, '') AS services,
        COALESCE(ai.products, '') AS products,
        COALESCE(ai.packages, '') AS packages,
        COALESCE(ai.memberships, '') AS memberships,
        COALESCE(ai.gift_cards, '') AS gift_cards,
        COALESCE(ai.other_items, '') AS other_items,
        COALESCE(ai.item_details, '[]'::jsonb) AS item_details,
        COALESCE(a.notes, '') AS notes
      FROM appointments a
      LEFT JOIN clients c
        ON c.id = a.client_id
      LEFT JOIN staff st
        ON st.id = a.staff_id
      LEFT JOIN appointment_payment ap
        ON ap.appointment_id = a.id
      LEFT JOIN appointment_items ai
        ON ai.appointment_id = a.id
      WHERE ${appointmentWhere.join(" AND ")}
    ),
    all_rows AS (
      SELECT * FROM sale_rows
      UNION ALL
      SELECT * FROM appointment_only_rows
    ),
    filtered_rows AS (
      SELECT *
      FROM all_rows fr
      ${searchClause}
    )
  `;

  const countResult = await safeQuery(() =>
    pool.query<{ total: string }>(
      `
      ${baseQuery}
      SELECT COUNT(*)::text AS total
      FROM filtered_rows
      `,
      values
    )
  );

  const rowsResult = await safeQuery(() =>
    pool.query(
      `
      ${baseQuery}
      SELECT
        sale_id,
        invoice_no,
        created_at,
        customer_name,
        mobile,
        staff_name,
        payment_method,
        payment_status,
        sale_status,
        gross_amount,
        discount,
        tax,
        tip,
        net_amount,
        collected_amount,
        pending_amount,
        total_quantity,
        services,
        products,
        packages,
        memberships,
        gift_cards,
        other_items,
        item_details,
        notes
      FROM filtered_rows
      ORDER BY ${sortColumn} ${sortOrder}, created_at DESC
      `,
      values
    )
  );

  const total = Number(countResult.rows[0]?.total ?? 0);
  const limit = rowsResult.rows.length;

  return {
    rows: rowsResult.rows.map((row) => ({
      saleId: row.sale_id,
      invoiceNo: row.invoice_no,
      date: row.created_at,
      customerName: row.customer_name,
      mobile: row.mobile,
      staffName: row.staff_name,
      paymentMethod: row.payment_method,
      paymentStatus: row.payment_status,
      saleStatus: row.sale_status,
      grossAmount: Number(row.gross_amount ?? 0),
      discount: Number(row.discount ?? 0),
      tax: Number(row.tax ?? 0),
      tip: Number(row.tip ?? 0),
      netAmount: Number(row.net_amount ?? 0),
      collectedAmount: Number(row.collected_amount ?? 0),
      pendingAmount: Number(row.pending_amount ?? 0),
      totalQuantity: Number(row.total_quantity ?? 0),
      services: row.services ?? "",
      products: row.products ?? "",
      packages: row.packages ?? "",
      memberships: row.memberships ?? "",
      giftCards: row.gift_cards ?? "",
      otherItems: row.other_items ?? "",
      itemDetails: Array.isArray(row.item_details)
        ? (row.item_details as SalesSummaryTableItemDetail[])
        : [],
      notes: row.notes ?? "",
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: total > 0 ? 1 : 0,
    },
  };
},

async getCategoryTotals(
  salonId: string,
  filters: { from?: string; to?: string }
): Promise<CategoryTotalsRow[]> {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query<CategoryTotalsRow>(
      `
      ${SALES_SUMMARY_ITEM_CTES}
      SELECT
        ni.item_type,

        COALESCE(
          SUM(COALESCE(ni.quantity, 1) * COALESCE(ni.unit_price, 0)),
          0
        )::text AS gross,

        COALESCE(
          SUM(COALESCE(ni.total_price, 0)),
          0
        )::text AS net,

        COALESCE(
          SUM(COALESCE(ni.quantity, 1)),
          0
        )::text AS qty

      FROM normalized_items ni
      JOIN sales s
        ON s.id = ni.sale_id

      WHERE ${where.join(" AND ")}

      GROUP BY ni.item_type
      ORDER BY ni.item_type;
      `,
      values
    )
  );

  return rows;
},
    
async getInvoiceAdjustments(
  salonId: string,
  filters: { from?: string; to?: string }
): Promise<InvoiceAdjustmentsRow> {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status IN ('completed', 'refunded')",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query<InvoiceAdjustmentsRow>(
      `
      SELECT
        COUNT(DISTINCT s.id) FILTER (
          WHERE s.status = 'completed'
        )::text AS invoice_count,

        COALESCE(
          SUM(
            CASE
              WHEN s.status = 'completed'
              THEN COALESCE(s.discount_amount, 0)
              ELSE 0
            END
          ),
          0
        )::text AS extra_discount_total,

        COALESCE(
          SUM(
            CASE
              WHEN s.status = 'completed'
              THEN COALESCE(s.tax_amount, 0)
              ELSE 0
            END
          ),
          0
        )::text AS tax_total,

        COALESCE(
          SUM(
            CASE
              WHEN s.status = 'refunded'
              THEN COALESCE(s.total_amount, 0)
              ELSE 0
            END
          ),
          0
        )::text AS refund_total

      FROM sales s
      WHERE ${where.join(" AND ")}
      `,
      values
    )
  );

  return (
    rows[0] ?? {
      invoice_count: "0",
      extra_discount_total: "0",
      tax_total: "0",
      refund_total: "0",
    }
  );
},

async getFootfallSummary(
  salonId: string,
  filters: { from?: string; to?: string }
): Promise<FootfallRow> {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "s.client_id IS NOT NULL",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query<FootfallRow>(
      `
      ${SALES_SUMMARY_ITEM_CTES},
      first_visit AS (
        SELECT
          client_id,
          MIN(created_at) AS first_date
        FROM sales
        WHERE
          salon_id = $1
          AND status = 'completed'
          AND client_id IS NOT NULL
        GROUP BY client_id
      ),

      range_visits AS (
        SELECT DISTINCT
          s.client_id
        FROM sales s
        WHERE ${where.join(" AND ")}
      ),

      service_clients AS (
        SELECT DISTINCT
          s.client_id
        FROM sales s
        JOIN normalized_items ni
          ON ni.sale_id = s.id
        WHERE
          ${where.join(" AND ")}
          AND ni.item_type = 'service'
      )

      SELECT
        COALESCE(
          (SELECT COUNT(*) FROM range_visits),
          0
        )::text AS total_guest,

        COALESCE(
          (
            SELECT COUNT(*)
            FROM range_visits rv
            JOIN first_visit fv
              ON fv.client_id = rv.client_id
            WHERE
              ${
                filters.from && filters.to
                  ? `DATE(fv.first_date) BETWEEN $2 AND $3`
                  : "TRUE"
              }
          ),
          0
        )::text AS new_guest,

        COALESCE(
          (SELECT COUNT(*) FROM service_clients),
          0
        )::text AS guest_purchased_services;
      `,
      values
    )
  );

  return (
    rows[0] ?? {
      total_guest: "0",
      new_guest: "0",
      guest_purchased_services: "0",
    }
  );
},

async getTopServices(
  salonId: string,
  filters: { from?: string; to?: string }
): Promise<TopItemRow[]> {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "ni.item_type = 'service'",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query<TopItemRow>(
      `
      ${SALES_SUMMARY_ITEM_CTES}
      SELECT
        COALESCE(MAX(ni.item_id), LOWER(MAX(COALESCE(ni.name, 'service')))) AS id,
        MAX(ni.name) AS name,

        COALESCE(
          SUM(COALESCE(ni.quantity, 1)),
          0
        )::text AS qty,

        COALESCE(
          SUM(COALESCE(ni.total_price, 0)),
          0
        )::text AS revenue

      FROM normalized_items ni
      JOIN sales s
        ON s.id = ni.sale_id

      WHERE ${where.join(" AND ")}

      GROUP BY COALESCE(ni.item_id, LOWER(COALESCE(ni.name, 'service')))

      ORDER BY
        SUM(COALESCE(ni.total_price, 0)) DESC,
        SUM(COALESCE(ni.quantity, 1)) DESC

      LIMIT 5;
      `,
      values
    )
  );

  return rows;
},

async getTopProducts(
  salonId: string,
  filters: { from?: string; to?: string }
): Promise<TopItemRow[]> {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "si.item_type = 'product'",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query<TopItemRow>(
      `
      SELECT
        COALESCE(
          MAX(si.item_id::text),
          LOWER(MAX(COALESCE(si.name, 'product')))
        ) AS id,
        MAX(si.name) AS name,

        COALESCE(
          SUM(COALESCE(si.quantity, 1)),
          0
        )::text AS qty,

        COALESCE(
          SUM(COALESCE(si.total_price, 0)),
          0
        )::text AS revenue

      FROM sale_items si

      JOIN sales s
        ON s.id = si.sale_id

      WHERE ${where.join(" AND ")}

      GROUP BY COALESCE(si.item_id::text, LOWER(COALESCE(si.name, 'product')))

      ORDER BY
        SUM(COALESCE(si.total_price, 0)) DESC,
        SUM(COALESCE(si.quantity, 1)) DESC

      LIMIT 5;
      `,
      values
    )
  );

  return rows;
},


async getTopMemberships(
  salonId: string,
  filters: { from?: string; to?: string }
): Promise<TopItemRow[]> {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "si.item_type = 'membership'",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query<TopItemRow>(
      `
      SELECT
        COALESCE(
          MAX(si.item_id::text),
          LOWER(MAX(COALESCE(si.name, 'membership')))
        ) AS id,
        MAX(si.name) AS name,

        COALESCE(
          SUM(COALESCE(si.quantity, 1)),
          0
        )::text AS qty,

        COALESCE(
          SUM(COALESCE(si.total_price, 0)),
          0
        )::text AS revenue

      FROM sale_items si

      JOIN sales s
        ON s.id = si.sale_id

      WHERE ${where.join(" AND ")}

      GROUP BY COALESCE(si.item_id::text, LOWER(COALESCE(si.name, 'membership')))

      ORDER BY
        SUM(COALESCE(si.total_price, 0)) DESC,
        SUM(COALESCE(si.quantity, 1)) DESC

      LIMIT 5;
      `,
      values
    )
  );

  return rows;
} ,

async getTopPackages(
  salonId: string,
  filters: { from?: string; to?: string }
): Promise<TopItemRow[]> {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "ni.item_type = 'package'",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query<TopItemRow>(
      `
      ${SALES_SUMMARY_ITEM_CTES}
      SELECT
        COALESCE(MAX(ni.item_id), LOWER(MAX(COALESCE(ni.name, 'package')))) AS id,
        MAX(ni.name) AS name,
        COALESCE(SUM(COALESCE(ni.quantity, 1)), 0)::text AS qty,
        COALESCE(SUM(COALESCE(ni.total_price, 0)), 0)::text AS revenue
      FROM normalized_items ni
      JOIN sales s
        ON s.id = ni.sale_id
      WHERE ${where.join(" AND ")}
      GROUP BY COALESCE(ni.item_id, LOWER(COALESCE(ni.name, 'package')))
      ORDER BY
        SUM(COALESCE(ni.total_price, 0)) DESC,
        SUM(COALESCE(ni.quantity, 1)) DESC
      LIMIT 5;
      `,
      values
    )
  );

  return rows;
},

async getTopStylists(
  salonId: string,
  filters: { from?: string; to?: string }
): Promise<TopStylistRow[]> {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query<TopStylistRow>(
      `
      ${SALES_SUMMARY_ITEM_CTES}
      SELECT
        COALESCE(st.id::text, COALESCE(ni.item_staff_id::text, ni.sale_staff_id::text, 'unassigned')) AS id,
        MAX(st.first_name) AS first_name,
        MAX(st.last_name) AS last_name,

        COUNT(DISTINCT s.id)::text AS booking_count,

        COALESCE(
          SUM(ni.total_price),
          0
        )::text AS revenue

      FROM sales s

      INNER JOIN normalized_items ni
        ON ni.sale_id = s.id

      LEFT JOIN staff st
        ON st.id = COALESCE(ni.item_staff_id, ni.sale_staff_id)

      WHERE ${where.join(" AND ")}

      GROUP BY
        COALESCE(st.id::text, COALESCE(ni.item_staff_id::text, ni.sale_staff_id::text, 'unassigned'))

      ORDER BY
        SUM(ni.total_price) DESC,
        COUNT(DISTINCT s.id) DESC

      LIMIT 5;
      `,
      values
    )
  );

  return rows;
},

async getProductRevenueCards(
  salonId: string,
  filters: ProductRevenueFilters
) {
  const { values, ctes, whereClause } =
    buildProductRevenueSourceQuery(
      salonId,
      filters
    );

  const sql = `
    ${ctes}
    SELECT
      COALESCE(SUM(pr.total_price), 0) AS total_revenue,
      COALESCE(SUM(pr.quantity), 0) AS products_sold,
      COALESCE(AVG(pr.total_price), 0) AS average_revenue,
      (
        SELECT pr2.product_name
        FROM product_rows pr2
        WHERE ${whereClause.replace(/pr\./g, "pr2.")}
        GROUP BY pr2.product_name
        ORDER BY SUM(pr2.total_price) DESC
        LIMIT 1
      ) AS top_product,
      (
        SELECT COALESCE(pr2.brand_name, '-')
        FROM product_rows pr2
        WHERE ${whereClause.replace(/pr\./g, "pr2.")}
        GROUP BY pr2.brand_name
        ORDER BY SUM(pr2.total_price) DESC
        LIMIT 1
      ) AS top_brand,
      (
        SELECT COALESCE(pr2.category_name, '-')
        FROM product_rows pr2
        WHERE ${whereClause.replace(/pr\./g, "pr2.")}
        GROUP BY pr2.category_name
        ORDER BY SUM(pr2.total_price) DESC
        LIMIT 1
      ) AS top_category,
      COALESCE(
        AVG(
          CASE
            WHEN pr.total_price > 0 THEN
              ((pr.total_price - (COALESCE(pr.supply_price, 0) * pr.quantity)) / pr.total_price) * 100
          END
        ),
        0
      ) AS profit_margin
    FROM product_rows pr
    WHERE ${whereClause};
  `;

  const { rows } = await safeQuery(() =>
    pool.query(sql, values)
  );

  const row = rows[0];

  return {
    totalRevenue: Number(row.total_revenue ?? 0),
    productsSold: Number(row.products_sold ?? 0),
    averageRevenue: Number(row.average_revenue ?? 0),
    topProduct: row.top_product ?? "-",
    topBrand: row.top_brand ?? "-",
    topCategory: row.top_category ?? "-",
    profitMargin: Number(row.profit_margin ?? 0),
  };
},
// ======================================================
// MONTHLY REVENUE TREND
// ======================================================

async getRevenueTrend(
  salonId: string,
  filters: ProductRevenueFilters
) {
  const { values, ctes, whereClause } =
    buildProductRevenueSourceQuery(
      salonId,
      filters
    );

  // Dynamic grouping. pr.sale_date is a timestamptz (sales.created_at or
  // appointments.created_at, both confirmed timestamptz — see
  // buildProductRevenueSourceQuery), so DATE_TRUNC/TO_CHAR need the same
  // explicit IST conversion as everywhere else, or "day"/"hour" buckets
  // silently shift by the UTC offset. groupFormat and groupBy must stay
  // textually identical in the AT TIME ZONE expression they wrap — Postgres
  // only allows the SELECT-list TO_CHAR(...) here because it's a function of
  // the exact GROUP BY expression.
  let groupFormat = `TO_CHAR(DATE_TRUNC('month', pr.sale_date AT TIME ZONE 'Asia/Kolkata'), 'Mon YYYY')`;
  let groupBy = `DATE_TRUNC('month', pr.sale_date AT TIME ZONE 'Asia/Kolkata')`;

  if (filters.from && filters.to) {
    const from = new Date(filters.from);
    const to = new Date(filters.to);

    const diffDays =
      Math.floor(
        (to.getTime() - from.getTime()) /
          (1000 * 60 * 60 * 24)
      ) + 1;

    if (diffDays === 1) {
      groupFormat = `TO_CHAR(DATE_TRUNC('hour', pr.sale_date AT TIME ZONE 'Asia/Kolkata'), 'HH24:00')`;
      groupBy = `DATE_TRUNC('hour', pr.sale_date AT TIME ZONE 'Asia/Kolkata')`;
    } else if (diffDays <= 7) {
      groupFormat = `TO_CHAR(DATE_TRUNC('day', pr.sale_date AT TIME ZONE 'Asia/Kolkata'), 'Dy')`;
      groupBy = `DATE_TRUNC('day', pr.sale_date AT TIME ZONE 'Asia/Kolkata')`;
    } else if (diffDays <= 31) {
      groupFormat = `TO_CHAR(DATE_TRUNC('day', pr.sale_date AT TIME ZONE 'Asia/Kolkata'), 'DD Mon')`;
      groupBy = `DATE_TRUNC('day', pr.sale_date AT TIME ZONE 'Asia/Kolkata')`;
    } else {
      groupFormat = `TO_CHAR(DATE_TRUNC('month', pr.sale_date AT TIME ZONE 'Asia/Kolkata'), 'Mon')`;
      groupBy = `DATE_TRUNC('month', pr.sale_date AT TIME ZONE 'Asia/Kolkata')`;
    }
  }

  const sql = `
    ${ctes}
    SELECT
      ${groupFormat} AS period,

      COALESCE(SUM(pr.total_price), 0) AS revenue,

      COALESCE(SUM(pr.quantity), 0) AS quantity_sold

    FROM product_rows pr

    WHERE ${whereClause}

    GROUP BY ${groupBy}

    ORDER BY ${groupBy};
  `;

  const { rows } = await safeQuery(() =>
    pool.query<{
      period: string;
      revenue: string;
      quantity_sold: string;
    }>(sql, values)
  );

  return rows.map((row) => ({
    period: row.period,
    revenue: Number(row.revenue),
    quantitySold: Number(row.quantity_sold),
  }));
},
// ======================================================
// BRAND REVENUE (PIE CHART)
// ======================================================

async getCategoryRevenue(
  salonId: string,
  filters: ProductRevenueFilters
) {
  const { values, ctes, whereClause } =
    buildProductRevenueSourceQuery(
      salonId,
      filters
    );

  const sql = `
    ${ctes}
    SELECT
      COALESCE(pr.category_name, 'Unassigned') AS category,
      COALESCE(SUM(pr.total_price), 0) AS revenue,
      COALESCE(SUM(pr.quantity), 0) AS quantity
    FROM product_rows pr
    WHERE ${whereClause}

    GROUP BY
      pr.category_name

    ORDER BY
      revenue DESC;
  `;

  const { rows } = await safeQuery(() =>
    pool.query<{
      category: string;
      revenue: string;
      quantity: string;
    }>(sql, values)
  );

  const totalRevenue = rows.reduce(
    (sum, row) => sum + Number(row.revenue),
    0
  );

  return rows.map((row) => ({
    name: row.category,
    revenue: Number(row.revenue),
    quantity: Number(row.quantity),
    percentage:
      totalRevenue === 0
        ? 0
        : Number(
            (
              (Number(row.revenue) * 100) /
              totalRevenue
            ).toFixed(2)
          ),
  }));
},

async getBrandRevenue(
  salonId: string,
  filters: ProductRevenueFilters
) {
  const { values, ctes, whereClause } =
    buildProductRevenueSourceQuery(
      salonId,
      filters
    );

  const sql = `
    ${ctes}
    SELECT
      COALESCE(pr.brand_name, 'Unassigned') AS brand,
      COALESCE(SUM(pr.total_price), 0) AS revenue,
      COALESCE(SUM(pr.quantity), 0) AS quantity
    FROM product_rows pr
    WHERE ${whereClause}

    GROUP BY
      pr.brand_name

    ORDER BY
      revenue DESC;
  `;

  const { rows } = await safeQuery(() =>
    pool.query<{
      brand: string;
      revenue: string;
      quantity: string;
    }>(sql, values)
  );

  const totalRevenue = rows.reduce(
    (sum, row) => sum + Number(row.revenue),
    0
  );

  return rows.map((row) => ({
    name: row.brand,
    revenue: Number(row.revenue),
    quantity: Number(row.quantity),
    percentage:
      totalRevenue === 0
        ? 0
        : Number(
            (
              (Number(row.revenue) * 100) /
              totalRevenue
            ).toFixed(2)
          ),
  }));
},
// ======================================================
// TOP REVENUE PRODUCTS (BAR CHART)
// ======================================================
async getTopRevenueProducts(
  salonId: string,
  filters: ProductRevenueFilters
) {
  const { values, ctes, whereClause } =
    buildProductRevenueSourceQuery(
      salonId,
      filters
    );

  const sql = `
    ${ctes}
    SELECT

      pr.id,
      pr.product_name AS product,
      COALESCE(pr.brand_name, 'Unassigned') AS brand,
      COALESCE(pr.category_name, 'Unassigned') AS category,
      SUM(pr.quantity)::INT AS quantity,
      COALESCE(SUM(pr.total_price), 0) AS revenue,
      ROUND(AVG(pr.unit_price), 2) AS average_price,
      ROUND(SUM(COALESCE(pr.supply_price, 0) * pr.quantity), 2) AS total_cost,
      ROUND(SUM(pr.total_price) - SUM(COALESCE(pr.supply_price, 0) * pr.quantity), 2) AS profit
    FROM product_rows pr
    WHERE ${whereClause}

    GROUP BY
      pr.id,
      pr.product_name,
      pr.brand_name,
      pr.category_name

    ORDER BY
      revenue DESC,
      quantity DESC

    LIMIT 5;
  `;

  const { rows } = await safeQuery(() =>
    pool.query<{
      id: string;
      product: string;
      brand: string;
      category: string;
      quantity: string;
      revenue: string;
      average_price: string;
      total_cost: string;
      profit: string;
    }>(sql, values)
  );

  return rows.map((row) => ({
    id: row.id,
    product: row.product,
    brand: row.brand,
    category: row.category,
    quantity: Number(row.quantity),
    revenue: Number(row.revenue),
    averagePrice: Number(row.average_price),
    totalCost: Number(row.total_cost),
    profit: Number(row.profit),
  }));
},


async getProductRevenueAnalytics(
  salonId: string,
  filters: ProductRevenueFilters
) {
  const { values, ctes, whereClause } =
    buildProductRevenueSourceQuery(
      salonId,
      filters
    );

  const sql = `
    ${ctes},
    product_sales AS (
      SELECT *
      FROM product_rows pr
      WHERE ${whereClause}
    ),

    highest_product AS (

      SELECT
        product_name,
        SUM(total_price) AS revenue

      FROM product_sales

      GROUP BY product_name

      ORDER BY revenue DESC

      LIMIT 1

    ),

    top_brand AS (

      SELECT
        brand_name,
        SUM(total_price) AS revenue

      FROM product_sales

      GROUP BY brand_name

      ORDER BY revenue DESC

      LIMIT 1

    ),

    top_category AS (

      SELECT
        category_name,
        SUM(total_price) AS revenue

      FROM product_sales

      GROUP BY category_name

      ORDER BY revenue DESC

      LIMIT 1

    ),

    top_sales_person AS (

      SELECT
        sales_person,
        SUM(total_price) AS revenue

      FROM product_sales

      GROUP BY sales_person

      ORDER BY revenue DESC

      LIMIT 1

    )

    SELECT

      (SELECT product_name FROM highest_product)
        AS highest_revenue_product,

      COALESCE(
        (SELECT revenue FROM highest_product),
        0
      ) AS highest_revenue,

      (SELECT brand_name FROM top_brand)
        AS top_brand,

      COALESCE(
        (SELECT revenue FROM top_brand),
        0
      ) AS brand_revenue,

      (SELECT category_name FROM top_category)
        AS top_category,

      COALESCE(
        (SELECT revenue FROM top_category),
        0
      ) AS category_revenue,

      (SELECT sales_person FROM top_sales_person)
        AS top_sales_person,

      COALESCE(
        (SELECT revenue FROM top_sales_person),
        0
      ) AS sales_person_revenue,

      COALESCE(
        (
          SELECT ROUND(
            AVG(total_price),
            2
          )
          FROM product_sales
        ),
        0
      ) AS average_order_value,

      COALESCE(
        (
          SELECT ROUND(
            CASE
              WHEN SUM(total_price) = 0 THEN 0
              ELSE
                (
                  (
                    SUM(total_price)
                    -
                    SUM(supply_price * quantity)
                  )
                  /
                  SUM(total_price)
                ) * 100
            END,
            2
          )
          FROM product_sales
        ),
        0
      ) AS profit_margin;
  `;

  const { rows } = await safeQuery(() =>
    pool.query(sql, values)
  );

  const row = rows[0];

  return {
    highestRevenueProduct: row.highest_revenue_product ?? "-",
    highestRevenue: Number(row.highest_revenue ?? 0),

    topBrand: row.top_brand ?? "-",
    brandRevenue: Number(row.brand_revenue ?? 0),

    topCategory: row.top_category ?? "-",
    categoryRevenue: Number(row.category_revenue ?? 0),

    topSalesPerson: row.top_sales_person?.trim() || "-",
    salesPersonRevenue: Number(row.sales_person_revenue ?? 0),

    averageOrderValue: Number(row.average_order_value ?? 0),

    profitMargin: Number(row.profit_margin ?? 0),
  };
},

async getProductRevenueTable(
  salonId: string,
  filters: ProductRevenueFilters
) {
  const { values, ctes, whereClause } =
    buildProductRevenueSourceQuery(
      salonId,
      filters
    );

  const sql = `
    ${ctes}
    SELECT
      pr.id,
      pr.product_name,
      pr.barcode,
      COALESCE(pr.brand_name, '-') AS brand,
      COALESCE(pr.category_name, '-') AS category,
      SUM(pr.quantity)::INT AS quantity_sold,
      ROUND(AVG(pr.unit_price), 2) AS unit_price,
      ROUND(SUM(pr.unit_price * pr.quantity), 2) AS revenue,
      ROUND(SUM(COALESCE(pr.discount, 0)), 2) AS discount,
      ROUND(SUM(pr.total_price), 2) AS net_revenue,
      CASE
        WHEN COALESCE(MAX(NULLIF(pr.sales_person, '')), '') = ''
        THEN '-'
        ELSE COALESCE(MAX(NULLIF(pr.sales_person, '')), '-')
      END AS sales_person,
      CASE
        WHEN COUNT(*) FILTER (WHERE pr.source = 'Sale') > 0
        THEN 'Sale'
        ELSE 'Appointment'
      END AS source,
      MAX(pr.sale_date) AS last_sale_date
    FROM product_rows pr
    WHERE ${whereClause}
    GROUP BY
      pr.id,
      pr.product_name,
      pr.barcode,
      pr.brand_name,
      pr.category_name
    ORDER BY
      net_revenue DESC,
      quantity_sold DESC;
  `;

  const { rows } = await safeQuery(() =>
    pool.query(sql, values)
  );

  return rows.map((row) => ({
    id: row.id,
    productName: row.product_name,
    barcode: row.barcode,
    brand: row.brand,
    category: row.category,
    quantitySold: Number(row.quantity_sold),
    unitPrice: Number(row.unit_price),
    revenue: Number(row.revenue),
    discount: Number(row.discount),
    netRevenue: Number(row.net_revenue),
    salesPerson: row.sales_person?.trim() || "-",
    source: row.source,
    lastSaleDate: row.last_sale_date,
  }));
},

async getStylistRevenueCards(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];
  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "si.item_type = 'service'",
    "COALESCE(si.staff_id, s.staff_id) IS NOT NULL",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const sql = `
    SELECT
      COALESCE(SUM(si.total_price), 0) AS total_revenue,
      COUNT(DISTINCT COALESCE(si.staff_id, s.staff_id)) AS stylists,
      COUNT(DISTINCT COALESCE(s.appointment_id, s.id)) AS appointments,
      COALESCE(
        (
          SELECT CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))
          FROM sales s2
          JOIN sale_items si2
            ON si2.sale_id = s2.id
          LEFT JOIN staff st
            ON st.id = COALESCE(si2.staff_id, s2.staff_id)
          WHERE
            s2.salon_id = $1
            AND s2.status = 'completed'
            AND si2.item_type = 'service'
            AND COALESCE(si2.staff_id, s2.staff_id) IS NOT NULL
            ${filters.from ? `AND DATE(s2.created_at) >= $${filters.to ? 2 : 2}` : ""}
            ${filters.to ? `AND DATE(s2.created_at) <= $${filters.from ? 3 : 2}` : ""}
          GROUP BY st.id, st.first_name, st.last_name
          ORDER BY SUM(si2.total_price) DESC
          LIMIT 1
        ),
        '-'
      ) AS top_stylist
    FROM sales s
    JOIN sale_items si
      ON si.sale_id = s.id
    WHERE ${where.join(" AND ")}
  `;

  const { rows } = await safeQuery(() =>
    pool.query(sql, values)
  );

  const row = rows[0] ?? {};
  const totalRevenue = Number(row.total_revenue ?? 0);
  const stylistCount = Number(row.stylists ?? 0);

  let growth = 0;

  if (filters.from && filters.to) {
    const diff =
      Math.floor(
        (new Date(filters.to).getTime() - new Date(filters.from).getTime()) /
          86400000
      ) + 1;

    const previous = await safeQuery(() =>
      pool.query(
        `
        SELECT COALESCE(SUM(si.total_price), 0) AS revenue
        FROM sales s
        JOIN sale_items si
          ON si.sale_id = s.id
        WHERE
          s.salon_id = $1
          AND s.status = 'completed'
          AND si.item_type = 'service'
          AND COALESCE(si.staff_id, s.staff_id) IS NOT NULL
          AND DATE(s.created_at)
            BETWEEN ($2::date - (${diff})::int)
            AND ($2::date - 1)
        `,
        [salonId, filters.from]
      )
    );

    const previousRevenue = Number(previous.rows[0]?.revenue ?? 0);

    if (previousRevenue > 0) {
      growth = ((totalRevenue - previousRevenue) / previousRevenue) * 100;
    }
  }

  return {
    totalRevenue,
    stylists: stylistCount,
    appointments: Number(row.appointments ?? 0),
    topStylist: String(row.top_stylist ?? "-").trim() || "-",
    avgRevenuePerStylist:
      stylistCount > 0 ? Number((totalRevenue / stylistCount).toFixed(2)) : 0,
    growth: Number(growth.toFixed(2)),
  };
},

async getStylistRevenueTrend(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];
  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "si.item_type = 'service'",
    "COALESCE(si.staff_id, s.staff_id) IS NOT NULL",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  let groupExpr = `TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'Mon YYYY')`;
  let groupByExpr = `DATE_TRUNC('month', s.created_at AT TIME ZONE 'Asia/Kolkata')`;

  if (filters.from && filters.to) {
    const from = new Date(filters.from);
    const to = new Date(filters.to);

    const diffDays =
      Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    if (diffDays === 1) {
      groupExpr = `TO_CHAR(DATE_TRUNC('hour', s.created_at AT TIME ZONE 'Asia/Kolkata'), 'HH24:00')`;
      groupByExpr = `DATE_TRUNC('hour', s.created_at AT TIME ZONE 'Asia/Kolkata')`;
    } else if (diffDays <= 7) {
      groupExpr = `TO_CHAR(DATE_TRUNC('day', s.created_at AT TIME ZONE 'Asia/Kolkata'), 'Dy')`;
      groupByExpr = `DATE_TRUNC('day', s.created_at AT TIME ZONE 'Asia/Kolkata')`;
    } else if (diffDays <= 31) {
      groupExpr = `TO_CHAR(DATE_TRUNC('day', s.created_at AT TIME ZONE 'Asia/Kolkata'), 'DD Mon')`;
      groupByExpr = `DATE_TRUNC('day', s.created_at AT TIME ZONE 'Asia/Kolkata')`;
    } else {
      groupExpr = `TO_CHAR(DATE_TRUNC('month', s.created_at AT TIME ZONE 'Asia/Kolkata'), 'Mon')`;
      groupByExpr = `DATE_TRUNC('month', s.created_at AT TIME ZONE 'Asia/Kolkata')`;
    }
  }

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      SELECT
        ${groupExpr} AS period,
        COALESCE(SUM(si.total_price), 0) AS revenue
      FROM sales s
      JOIN sale_items si
        ON si.sale_id = s.id
      WHERE ${where.join(" AND ")}
      GROUP BY ${groupByExpr}
      ORDER BY ${groupByExpr}
      `,
      values
    )
  );

  return rows.map((row) => ({
    period: row.period,
    revenue: Number(row.revenue ?? 0),
  }));
},

async getStylistDepartmentRevenue(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];
  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "si.item_type = 'service'",
    "COALESCE(si.staff_id, s.staff_id) IS NOT NULL",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      SELECT
        COALESCE(sc.name, 'Others') AS name,
        COALESCE(SUM(si.total_price), 0) AS revenue
      FROM sales s
      JOIN sale_items si
        ON si.sale_id = s.id
      LEFT JOIN services sv
        ON sv.id = si.item_id
      LEFT JOIN service_categories sc
        ON sc.id = sv.category_id
      WHERE ${where.join(" AND ")}
      GROUP BY sc.id, sc.name
      ORDER BY revenue DESC
      `,
      values
    )
  );

  const totalRevenue = rows.reduce(
    (sum, row) => sum + Number(row.revenue ?? 0),
    0
  );

  return rows.map((row) => ({
    name: row.name,
    revenue: Number(row.revenue ?? 0),
    percentage:
      totalRevenue > 0
        ? Number((((Number(row.revenue ?? 0) * 100) / totalRevenue)).toFixed(2))
        : 0,
  }));
},

async getTopStylistRevenue(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];
  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "si.item_type = 'service'",
    "COALESCE(si.staff_id, s.staff_id) IS NOT NULL",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      SELECT
        COALESCE(CONCAT(st.first_name, ' ', st.last_name), 'Unknown') AS name,
        COALESCE(SUM(si.total_price), 0) AS revenue,
        COUNT(DISTINCT COALESCE(s.appointment_id, s.id)) AS appointments
      FROM sales s
      JOIN sale_items si
        ON si.sale_id = s.id
      LEFT JOIN staff st
        ON st.id = COALESCE(si.staff_id, s.staff_id)
      WHERE ${where.join(" AND ")}
      GROUP BY st.id, st.first_name, st.last_name
      ORDER BY revenue DESC, appointments DESC
      LIMIT 10
      `,
      values
    )
  );

  return rows.map((row) => ({
    name: String(row.name ?? "Unknown").trim() || "Unknown",
    revenue: Number(row.revenue ?? 0),
    appointments: Number(row.appointments ?? 0),
  }));
},

async getStylistRevenueAnalytics(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];
  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "si.item_type = 'service'",
    "COALESCE(si.staff_id, s.staff_id) IS NOT NULL",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      WITH service_sale_totals AS (
        SELECT
          si.sale_id,
          SUM(si.total_price) AS service_total
        FROM sale_items si
        WHERE si.item_type = 'service'
        GROUP BY si.sale_id
      ),
      staff_sale_totals AS (
        SELECT
          s.id AS sale_id,
          COALESCE(si.staff_id, s.staff_id) AS staff_id,
          COALESCE(CONCAT(st.first_name, ' ', st.last_name), 'Unknown') AS stylist_name,
          s.client_id,
          SUM(COALESCE(si.total_price, 0)) AS revenue,
          ROUND(
            CASE
              WHEN COALESCE(sst.service_total, 0) = 0 THEN 0
              ELSE COALESCE(NULLIF(s.tip_amount::numeric, 0), COALESCE(a.tip_amount::numeric, 0), 0) * (SUM(COALESCE(si.total_price, 0)) / sst.service_total)
            END,
            2
          ) AS sale_tip,
          COALESCE(ce.commission_amount, 0) AS sale_staff_commission
        FROM sales s
        JOIN sale_items si
          ON si.sale_id = s.id
        LEFT JOIN appointments a
          ON a.id = s.appointment_id
        LEFT JOIN staff st
          ON st.id = COALESCE(si.staff_id, s.staff_id)
        LEFT JOIN service_sale_totals sst
          ON sst.sale_id = s.id
        LEFT JOIN (
          SELECT
            sale_id,
            staff_id,
            SUM(commission_amount) AS commission_amount
          FROM commission_earned
          WHERE salon_id = $1
            AND category = 'services'
          GROUP BY sale_id, staff_id
        ) ce
          ON ce.sale_id = s.id
          AND ce.staff_id = COALESCE(si.staff_id, s.staff_id)
        WHERE ${where.join(" AND ")}
        GROUP BY
          s.id,
          COALESCE(si.staff_id, s.staff_id),
          st.first_name,
          st.last_name,
          s.client_id,
          sst.service_total,
          s.tip_amount,
          a.tip_amount,
          ce.commission_amount
      ),
      stylist_stats AS (
        SELECT
          staff_id,
          stylist_name,
          SUM(revenue) AS revenue,
          COUNT(DISTINCT client_id) AS clients_served,
          SUM(sale_tip) AS tips,
          SUM(sale_staff_commission) AS commission,
          AVG(revenue) AS avg_bill
        FROM staff_sale_totals
        GROUP BY staff_id, stylist_name
      )
      SELECT
        COALESCE(
          (SELECT stylist_name FROM stylist_stats ORDER BY revenue DESC LIMIT 1),
          '-'
        ) AS best_performing_stylist,
        COALESCE(
          (SELECT revenue FROM stylist_stats ORDER BY revenue DESC LIMIT 1),
          0
        ) AS best_performing_revenue,
        COALESCE(
          (SELECT stylist_name FROM stylist_stats ORDER BY clients_served DESC, revenue DESC LIMIT 1),
          '-'
        ) AS most_clients_stylist,
        COALESCE(
          (SELECT clients_served FROM stylist_stats ORDER BY clients_served DESC, revenue DESC LIMIT 1),
          0
        ) AS most_clients_served,
        COALESCE(
          (SELECT stylist_name FROM stylist_stats ORDER BY tips DESC, revenue DESC LIMIT 1),
          '-'
        ) AS highest_tips_stylist,
        COALESCE(
          (SELECT tips FROM stylist_stats ORDER BY tips DESC, revenue DESC LIMIT 1),
          0
        ) AS highest_tips,
        COALESCE(
          (SELECT stylist_name FROM stylist_stats ORDER BY commission DESC, revenue DESC LIMIT 1),
          '-'
        ) AS highest_commission_stylist,
        COALESCE(
          (SELECT commission FROM stylist_stats ORDER BY commission DESC, revenue DESC LIMIT 1),
          0
        ) AS highest_commission,
        COALESCE(
          (SELECT stylist_name FROM stylist_stats ORDER BY avg_bill DESC, revenue DESC LIMIT 1),
          '-'
        ) AS highest_avg_bill_stylist,
        COALESCE(
          (SELECT avg_bill FROM stylist_stats ORDER BY avg_bill DESC, revenue DESC LIMIT 1),
          0
        ) AS highest_avg_bill
      `,
      values
    )
  );

  const row = rows[0] ?? {};

  return {
    bestPerformingStylist: row.best_performing_stylist ?? "-",
    bestPerformingRevenue: Number(row.best_performing_revenue ?? 0),
    mostClientsServed: Number(row.most_clients_served ?? 0),
    mostClientsStylist: row.most_clients_stylist ?? "-",
    highestRevenue: Number(row.best_performing_revenue ?? 0),
    highestRevenueStylist: row.best_performing_stylist ?? "-",
    highestTips: Number(row.highest_tips ?? 0),
    highestTipsStylist: row.highest_tips_stylist ?? "-",
    highestCommission: Number(row.highest_commission ?? 0),
    highestCommissionStylist: row.highest_commission_stylist ?? "-",
    highestAverageBill: Number(row.highest_avg_bill ?? 0),
    highestAverageBillStylist: row.highest_avg_bill_stylist ?? "-",
  };
},

async getStylistRevenueTable(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
  }
) {
  const values: any[] = [salonId];

  const where = [
    "s.salon_id = $1",
    "s.status = 'completed'",
    "si.item_type = 'service'",
    "COALESCE(si.staff_id, s.staff_id) IS NOT NULL",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(s.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(s.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      WITH service_sale_totals AS (
        SELECT
          si.sale_id,
          SUM(si.total_price::numeric) AS service_total
        FROM sale_items si
        WHERE si.item_type = 'service'
        GROUP BY si.sale_id
      ),

      staff_service_totals AS (
        SELECT
          si.sale_id,
          COALESCE(si.staff_id, s.staff_id) AS staff_id,
          SUM(si.total_price::numeric) AS staff_service_total
        FROM sales s
        JOIN sale_items si
          ON si.sale_id = s.id
        WHERE
          s.salon_id = $1
          AND s.status = 'completed'
          AND si.item_type = 'service'
          AND COALESCE(si.staff_id, s.staff_id) IS NOT NULL
        GROUP BY
          si.sale_id,
          COALESCE(si.staff_id, s.staff_id)
      ),

      staff_commissions AS (
        SELECT
          sale_id,
          staff_id,
          SUM(commission_amount::numeric) AS commission_amount
        FROM commission_earned
        WHERE
          salon_id = $1
          AND category = 'services'
        GROUP BY
          sale_id,
          staff_id
      )
      SELECT
        s.id,

        COALESCE(
          s.invoice_number,
          s.id::text
        ) AS invoice_no,

        s.created_at AS sale_date,

        COALESCE(
          CONCAT(st.first_name, ' ', st.last_name),
          'Unknown'
        ) AS stylist,

        COALESCE(
          c.full_name,
          'Walk-in Client'
        ) AS client,

        COALESCE(
          c.phone_number,
          ''
        ) AS mobile,

        COALESCE(
          sc.name,
          'Others'
        ) AS department,

        COALESCE(
          si.name,
          sv.name,
          'Service'
        ) AS service,

        COALESCE(
          sv.duration_minutes,
          0
        ) AS duration_minutes,

        COALESCE(
          si.quantity,
          0
        ) AS qty,

        ROUND(
          COALESCE(si.unit_price::numeric, 0)
          *
          COALESCE(si.quantity, 0),
          2
        ) AS gross,

        ROUND(
          COALESCE(si.discount_amount::numeric, 0),
          2
        ) AS discount,

        ROUND(
          CASE
            WHEN COALESCE(sst.service_total, 0) = 0
            THEN 0
            ELSE
              COALESCE(s.tax_amount::numeric, 0)
              *
              (
                COALESCE(si.total_price::numeric, 0)
                /
                sst.service_total
              )
          END,
          2
        ) AS tax,

        ROUND(
          CASE
            WHEN COALESCE(sst.service_total, 0) = 0
            THEN 0
            ELSE
              COALESCE(
                NULLIF(s.tip_amount::numeric, 0),
                COALESCE(a.tip_amount::numeric, 0),
                0
              )
              *
              (
                COALESCE(si.total_price::numeric, 0)
                /
                sst.service_total
              )
          END,
          2
        ) AS tip,

        ROUND(
          CASE
            WHEN COALESCE(sts.staff_service_total, 0) = 0
            THEN 0
            ELSE
              COALESCE(comm.commission_amount, 0)
              *
              (
                COALESCE(si.total_price::numeric, 0)
                /
                sts.staff_service_total
              )
          END,
          2
        ) AS commission,

        ROUND(
          COALESCE(si.total_price::numeric, 0)

          +

          CASE
            WHEN COALESCE(sst.service_total, 0) = 0
            THEN 0
            ELSE
              COALESCE(s.tax_amount::numeric, 0)
              *
              (
                COALESCE(si.total_price::numeric, 0)
                /
                sst.service_total
              )
          END

          +

          CASE
            WHEN COALESCE(sst.service_total, 0) = 0
            THEN 0
            ELSE
              COALESCE(
                NULLIF(s.tip_amount::numeric, 0),
                COALESCE(a.tip_amount::numeric, 0),
                0
              )
              *
              (
                COALESCE(si.total_price::numeric, 0)
                /
                sst.service_total
              )
          END,
          2
        ) AS net_revenue,

        UPPER(
          COALESCE(
            s.payment_method,
            'N/A'
          )
        ) AS payment,

        CASE
          WHEN s.status = 'refunded'
          THEN 'Refunded'
          ELSE 'Completed'
        END AS status

      FROM sales s

      JOIN sale_items si
        ON si.sale_id = s.id

      LEFT JOIN clients c
        ON c.id = s.client_id

      LEFT JOIN appointments a
        ON a.id = s.appointment_id

      LEFT JOIN staff st
        ON st.id = COALESCE(
          si.staff_id,
          s.staff_id
        )

      LEFT JOIN services sv
        ON sv.id = si.item_id

      LEFT JOIN service_categories sc
        ON sc.id = sv.category_id

      LEFT JOIN service_sale_totals sst
        ON sst.sale_id = s.id

      LEFT JOIN staff_service_totals sts
        ON sts.sale_id = s.id
        AND sts.staff_id = COALESCE(
          si.staff_id,
          s.staff_id
        )

      LEFT JOIN staff_commissions comm
        ON comm.sale_id = s.id
        AND comm.staff_id = COALESCE(
          si.staff_id,
          s.staff_id
        )
                WHERE ${where.join(" AND ")}

      ORDER BY
        s.created_at DESC,
        invoice_no DESC
      `,
      values
    )
  );

  return rows.map((row) => ({
    id: row.id,

    invoiceNo: row.invoice_no,

    date: row.sale_date,

    stylist:
      String(row.stylist ?? "Unknown").trim() ||
      "Unknown",

    client: row.client,

    mobile: row.mobile,

    department: row.department,

    service: row.service,

    duration: `${Number(
      row.duration_minutes ?? 0
    )} Min`,

    qty: Number(row.qty ?? 0),

    gross: Number(row.gross ?? 0),

    discount: Number(row.discount ?? 0),

    tax: Number(row.tax ?? 0),

    tip: Number(row.tip ?? 0),

    commission: Number(row.commission ?? 0),

    netRevenue: Number(
      row.net_revenue ?? 0
    ),

    payment: row.payment,

    status: row.status,
  }));
},

async getTipReportTable(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
    search?: string;
    stylist?: string;
    payment?: string;
    status?: string;
  }
) {
  const values: any[] = [salonId];
  const where = [
    "a.salon_id = $1",
    "COALESCE(NULLIF(s.tip_amount::numeric, 0), COALESCE(a.tip_amount::numeric, 0), 0) > 0",
  ];

  let index = 2;

  if (filters.from) {
    where.push(`DATE(a.scheduled_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(a.scheduled_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  if (filters.search) {
    where.push(`
      (
        COALESCE(s.invoice_number, '') ILIKE $${index}
        OR COALESCE(c.full_name,'') ILIKE $${index}
        OR COALESCE(svc.service_name, sv.name, '') ILIKE $${index}
        OR COALESCE(svc.staff_name, CONCAT(st.first_name,' ',st.last_name), '') ILIKE $${index}
      )
    `);

    values.push(`%${filters.search}%`);
    index++;
  }

  if (filters.stylist) {
    where.push(`COALESCE(svc.staff_name, CONCAT(st.first_name,' ',st.last_name), 'Unknown') = $${index}`);

    values.push(filters.stylist);
    index++;
  }

  if (filters.payment) {
    where.push(`
      UPPER(
        COALESCE(
          pay.latest_method,
          s.payment_method,
          'N/A'
        )
      ) = UPPER($${index})
    `);

    values.push(filters.payment);
    index++;
  }

  if (filters.status) {
    if (filters.status.toLowerCase() === "collected") {
      where.push(`
        COALESCE(
          pay.latest_status,
          s.status,
          'completed'
        ) <> 'refunded'
      `);
    }

    if (filters.status.toLowerCase() === "refunded") {
      where.push(`
        COALESCE(
          pay.latest_status,
          s.status
        ) = 'refunded'
      `);
    }
  }

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      WITH pay AS (
        SELECT
          p.appointment_id,
          COUNT(*) FILTER (WHERE p.status IN ('completed', 'partial', 'refunded')) AS pay_count,
          MAX(p.payment_method) FILTER (
            WHERE p.created_at = (
              SELECT MAX(p2.created_at)
              FROM payments p2
              WHERE p2.appointment_id = p.appointment_id
            )
          ) AS latest_method,
          MAX(p.status) FILTER (
            WHERE p.created_at = (
              SELECT MAX(p2.created_at)
              FROM payments p2
              WHERE p2.appointment_id = p.appointment_id
            )
          ) AS latest_status
        FROM payments p
        GROUP BY p.appointment_id
      ),
      service_rows AS (
        SELECT
          a.id AS appointment_id,
          svc.value AS service_json,
          NULLIF(TRIM(COALESCE(svc.value->>'staff_name', '')), '') AS service_staff_name,
          NULLIF(svc.value->>'staff_id', '') AS service_staff_id,
          NULLIF(svc.value->>'service_id', '') AS service_id,
          COALESCE(
            NULLIF(svc.value->>'total', '')::numeric,
            (
              COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0)
              *
              COALESCE(NULLIF(svc.value->>'qty', '')::numeric, NULLIF(svc.value->>'quantity', '')::numeric, 1)
            )
          ) AS line_total
        FROM appointments a
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
          ON TRUE
      ),
      appointment_totals AS (
        SELECT
          sr.appointment_id,
          COALESCE(SUM(sr.line_total), 0) AS total_service_amount
        FROM service_rows sr
        GROUP BY sr.appointment_id
      )
      SELECT
        a.id,
        s.invoice_number AS invoice_no,
        a.scheduled_at AS sale_date,
        COALESCE(c.full_name, 'Walk-in Client') AS client,
        COALESCE(c.phone_number, '') AS mobile,
        COALESCE(
          sr.service_staff_name,
          CONCAT(st.first_name, ' ', st.last_name),
          'Unknown'
        ) AS stylist,
        COALESCE(sc.name, 'Others') AS department,
        COALESCE(sr.service_json->>'name', sv.name, 'Service') AS service,
        ROUND(
          COALESCE(sr.line_total, 0),
          2
        ) AS bill_amount,
        ROUND(
          CASE
            WHEN COALESCE(at.total_service_amount, 0) = 0
            THEN COALESCE(NULLIF(s.tip_amount::numeric, 0), COALESCE(a.tip_amount::numeric, 0), 0)
            ELSE
              COALESCE(NULLIF(s.tip_amount::numeric, 0), COALESCE(a.tip_amount::numeric, 0), 0)
              *
              (COALESCE(sr.line_total, 0) / at.total_service_amount)
          END,
          2
        ) AS tip_amount,
        UPPER(
          COALESCE(
            pay.latest_method,
            s.payment_method,
            'N/A'
          )
        ) AS payment,
        CASE
          WHEN COALESCE(pay.latest_status, s.status, 'completed') = 'refunded'
          THEN 'Refunded'
          ELSE 'Collected'
        END AS status
      FROM appointments a
      LEFT JOIN pay
        ON pay.appointment_id = a.id
      LEFT JOIN sales s
        ON s.id = a.sale_id
        OR s.appointment_id = a.id
      LEFT JOIN service_rows sr
        ON sr.appointment_id = a.id
      LEFT JOIN appointment_totals at
        ON at.appointment_id = a.id
      LEFT JOIN clients c
        ON c.id = a.client_id
      LEFT JOIN staff st
        ON st.id::text = COALESCE(sr.service_staff_id, a.staff_id::text)
      LEFT JOIN services sv
        ON sv.id::text = COALESCE(sr.service_id, a.service_id::text)
      LEFT JOIN service_categories sc
        ON sc.id = sv.category_id
      WHERE ${where.join(" AND ")}
      ORDER BY
        tip_amount DESC,
        a.scheduled_at DESC,
        invoice_no DESC
      `,
      values
    )
  );

    return rows.map((row) => ({

    id: row.id,

    invoiceNo: row.invoice_no,

    date: row.sale_date,

    client:
      row.client ??
      "Walk-in Client",

    mobile:
      row.mobile ?? "",

    stylist:
      String(
        row.stylist ?? "Unknown"
      ).trim() || "Unknown",

    department:
      row.department ??
      "Others",

    service:
      row.service ??
      "Service",

    duration:
      `${Number(
        row.duration_minutes ?? 0
      )} Min`,

    qty:
      Number(
        row.qty ?? 1
      ),

    gross:
      Number(
        row.gross ?? 0
      ),

    discount:
      Number(
        row.discount ?? 0
      ),

    tax:
      Number(
        row.tax ?? 0
      ),

    tip:
      Number(
        row.tip_amount ?? 0
      ),

    billAmount:
      Number(
        row.bill_amount ?? 0
      ),

    payment:
      row.payment ??
      "N/A",

    status:
      row.status,

  }));

},

async getAppointmentCards(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];
  const where = ["m.salon_id = $1"];
  let index = 2;

  if (filters.from) {
    where.push(`DATE(m.scheduled_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(m.scheduled_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${APPOINTMENT_BASE_CTES}
      SELECT
        COUNT(*) AS total_appointments,
        COUNT(*) FILTER (WHERE m.payment_state = 'paid') AS completed,
        COUNT(*) FILTER (WHERE m.payment_state = 'unpaid') AS pending,
        COUNT(*) FILTER (WHERE m.status = 'cancelled') AS cancelled,
        COUNT(*) FILTER (WHERE m.status = 'no-show') AS no_show,
        COUNT(*) FILTER (WHERE m.booking_source = 'Walk-in') AS walk_in_bookings,
        COUNT(*) FILTER (WHERE m.booking_source = 'Online') AS online_bookings,
        COALESCE(ROUND(AVG(m.appointment_amount) FILTER (WHERE m.payment_state = 'paid'), 2), 0) AS average_booking_value
      FROM metrics m
      WHERE ${where.join(" AND ")}
      `,
      values
    )
  );

  const row = rows[0] ?? {};

  return [
    { title: "Total Appointments", value: String(row.total_appointments ?? 0), trend: "", color: "primary", icon: "calendar" },
    { title: "Completed", value: String(row.completed ?? 0), trend: "", color: "success", icon: "check-circle" },
    { title: "Pending", value: String(row.pending ?? 0), trend: "", color: "warning", icon: "clock" },
    { title: "Cancelled", value: String(row.cancelled ?? 0), trend: "", color: "danger", icon: "x-circle" },
    { title: "No Show", value: String(row.no_show ?? 0), trend: "", color: "info", icon: "user-x" },
    { title: "Walk-in Bookings", value: String(row.walk_in_bookings ?? 0), trend: "", color: "purple", icon: "users" },
    { title: "Online Bookings", value: String(row.online_bookings ?? 0), trend: "", color: "teal", icon: "globe" },
    {
      title: "Average Booking Value",
      value: `₹ ${Number(row.average_booking_value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
      trend: "",
      color: "secondary",
      icon: "rupee-sign",
    },
  ];
},

async getAppointmentCharts(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];
  const where = ["m.salon_id = $1"];
  let index = 2;

  if (filters.from) {
    where.push(`DATE(m.scheduled_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(m.scheduled_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const dailyTrend = await safeQuery(() =>
    pool.query(
      `
      ${APPOINTMENT_BASE_CTES}
      SELECT
        TO_CHAR(DATE_TRUNC('day', m.scheduled_at AT TIME ZONE 'Asia/Kolkata'), 'Dy') AS date,
        COUNT(*) AS appointments
      FROM metrics m
      WHERE ${where.join(" AND ")}
      GROUP BY DATE_TRUNC('day', m.scheduled_at AT TIME ZONE 'Asia/Kolkata')
      ORDER BY DATE_TRUNC('day', m.scheduled_at AT TIME ZONE 'Asia/Kolkata')
      `,
      values
    )
  );

  const statusBreakdown = await safeQuery(() =>
    pool.query(
      `
      ${APPOINTMENT_BASE_CTES}
      SELECT * FROM (
        SELECT 'Completed' AS name, COUNT(*) FILTER (WHERE m.payment_state = 'paid') AS value FROM metrics m WHERE ${where.join(" AND ")}
        UNION ALL
        SELECT 'Pending' AS name, COUNT(*) FILTER (WHERE m.payment_state = 'unpaid') AS value FROM metrics m WHERE ${where.join(" AND ")}
        UNION ALL
        SELECT 'Cancelled' AS name, COUNT(*) FILTER (WHERE m.status = 'cancelled') AS value FROM metrics m WHERE ${where.join(" AND ")}
        UNION ALL
        SELECT 'No Show' AS name, COUNT(*) FILTER (WHERE m.status = 'no-show') AS value FROM metrics m WHERE ${where.join(" AND ")}
      ) q
      `,
      values
    )
  );

  const departmentAppointments = await safeQuery(() =>
    pool.query(
      `
      ${APPOINTMENT_BASE_CTES},
      service_rows AS (
        SELECT
          a.id AS appointment_id,
          NULLIF(svc.value->>'service_id', '') AS service_id
        FROM appointments a
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
          ON TRUE
      )
      SELECT
        COALESCE(sc.name, 'Others') AS name,
        COUNT(DISTINCT m.id) AS value
      FROM metrics m
      LEFT JOIN service_rows sr
        ON sr.appointment_id = m.id
      LEFT JOIN services sv
        ON sv.id::text = COALESCE(sr.service_id, m.service_id::text)
      LEFT JOIN service_categories sc
        ON sc.id = sv.category_id
      WHERE ${where.join(" AND ")}
      GROUP BY sc.id, sc.name
      ORDER BY value DESC, name ASC
      `,
      values
    )
  );

  const topStylists = await safeQuery(() =>
    pool.query(
      `
      ${APPOINTMENT_BASE_CTES},
      staff_rows AS (
        SELECT
          a.id AS appointment_id,
          NULLIF(TRIM(COALESCE(svc.value->>'staff_name', '')), '') AS staff_name,
          NULLIF(svc.value->>'staff_id', '') AS staff_id
        FROM appointments a
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
          ON TRUE
      )
      SELECT
        COALESCE(sr.staff_name, CONCAT(st.first_name, ' ', st.last_name), 'Unknown') AS name,
        COUNT(DISTINCT m.id) AS value
      FROM metrics m
      LEFT JOIN staff_rows sr
        ON sr.appointment_id = m.id
      LEFT JOIN staff st
        ON st.id::text = COALESCE(sr.staff_id, m.staff_id::text)
      WHERE ${where.join(" AND ")}
        AND m.payment_state = 'paid'
      GROUP BY name
      ORDER BY value DESC, name ASC
      LIMIT 5
      `,
      values
    )
  );

  return {
    dailyTrend: dailyTrend.rows.map((row) => ({
      date: row.date,
      appointments: Number(row.appointments ?? 0),
    })),
    statusBreakdown: statusBreakdown.rows.map((row) => ({
      name: row.name,
      value: Number(row.value ?? 0),
    })),
    departmentAppointments: departmentAppointments.rows.map((row) => ({
      name: row.name,
      value: Number(row.value ?? 0),
    })),
    topStylists: topStylists.rows.map((row) => ({
      name: String(row.name ?? "Unknown").trim() || "Unknown",
      value: Number(row.value ?? 0),
    })),
  };
},

async getAppointmentAnalytics(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];
  const where = ["m.salon_id = $1"];
  let index = 2;

  if (filters.from) {
    where.push(`DATE(m.scheduled_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(m.scheduled_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${APPOINTMENT_BASE_CTES},
      service_rows AS (
        SELECT
          a.id AS appointment_id,
          COALESCE(svc.value->>'name', 'Service') AS service_name,
          NULLIF(TRIM(COALESCE(svc.value->>'staff_name', '')), '') AS staff_name,
          NULLIF(svc.value->>'staff_id', '') AS staff_id
        FROM appointments a
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
          ON TRUE
      ),
      filtered AS (
        SELECT * FROM metrics m WHERE ${where.join(" AND ")}
      ),
      peak_day AS (
        SELECT TO_CHAR(DATE_TRUNC('day', scheduled_at AT TIME ZONE 'Asia/Kolkata'), 'FMDay') AS value
        FROM filtered
        GROUP BY DATE_TRUNC('day', scheduled_at AT TIME ZONE 'Asia/Kolkata')
        ORDER BY COUNT(*) DESC, DATE_TRUNC('day', scheduled_at AT TIME ZONE 'Asia/Kolkata') ASC
        LIMIT 1
      ),
      peak_hour AS (
        SELECT
          CONCAT(
            TO_CHAR(DATE_TRUNC('hour', scheduled_at AT TIME ZONE 'Asia/Kolkata'), 'FMHH12 AM'),
            ' - ',
            TO_CHAR(DATE_TRUNC('hour', scheduled_at AT TIME ZONE 'Asia/Kolkata') + INTERVAL '2 hour', 'FMHH12 AM')
          ) AS value
        FROM filtered
        GROUP BY DATE_TRUNC('hour', scheduled_at AT TIME ZONE 'Asia/Kolkata')
        ORDER BY COUNT(*) DESC, DATE_TRUNC('hour', scheduled_at AT TIME ZONE 'Asia/Kolkata') ASC
        LIMIT 1
      ),
      best_stylist AS (
        SELECT
          COALESCE(sr.staff_name, CONCAT(st.first_name, ' ', st.last_name), 'Unknown') AS value
        FROM filtered f
        LEFT JOIN service_rows sr
          ON sr.appointment_id = f.id
        LEFT JOIN staff st
          ON st.id::text = COALESCE(sr.staff_id, f.staff_id::text)
        WHERE f.payment_state = 'paid'
        GROUP BY value
        ORDER BY COUNT(DISTINCT f.id) DESC, value ASC
        LIMIT 1
      ),
      top_service AS (
        SELECT
          COALESCE(sr.service_name, 'Service') AS value
        FROM filtered f
        LEFT JOIN service_rows sr
          ON sr.appointment_id = f.id
        WHERE f.payment_state = 'paid'
        GROUP BY value
        ORDER BY COUNT(*) DESC, value ASC
        LIMIT 1
      ),
      cancellation_rate AS (
        SELECT
          COALESCE(
            ROUND(
              (COUNT(*) FILTER (WHERE status = 'cancelled')::numeric * 100)
              / NULLIF(COUNT(*), 0),
              2
            ),
            0
          ) AS value
        FROM filtered
      ),
      repeat_clients AS (
        SELECT
          COALESCE(
            ROUND(
              (COUNT(*) FILTER (WHERE client_completed_count > 1)::numeric * 100)
              / NULLIF(COUNT(*), 0),
              2
            ),
            0
          ) AS value
        FROM (
          SELECT
            client_id,
            COUNT(*) FILTER (WHERE payment_state = 'paid') AS client_completed_count
          FROM filtered
          WHERE client_id IS NOT NULL
          GROUP BY client_id
        ) rc
      )
      SELECT
        COALESCE((SELECT value FROM peak_day), '-') AS peak_booking_day,
        COALESCE((SELECT value FROM peak_hour), '-') AS peak_booking_hour,
        COALESCE((SELECT value FROM best_stylist), '-') AS best_performing_stylist,
        COALESCE((SELECT value FROM top_service), '-') AS top_service,
        COALESCE((SELECT value FROM cancellation_rate), 0) AS cancellation_rate,
        COALESCE((SELECT value FROM repeat_clients), 0) AS repeat_clients
      `,
      values
    )
  );

  const row = rows[0] ?? {};

  return [
    { title: "Peak Booking Day", value: row.peak_booking_day ?? "-", description: "Highest appointment count.", color: "primary", icon: "calendar-days" },
    { title: "Peak Booking Hour", value: row.peak_booking_hour ?? "-", description: "Most appointments booked.", color: "info", icon: "clock-3" },
    { title: "Best Performing Stylist", value: row.best_performing_stylist ?? "-", description: "Highest completed appointments.", color: "success", icon: "award" },
    { title: "Top Service", value: row.top_service ?? "-", description: "Most booked service.", color: "warning", icon: "scissors" },
    { title: "Cancellation Rate", value: `${Number(row.cancellation_rate ?? 0).toFixed(2)}%`, description: "Cancelled / Total Appointments x 100.", color: "danger", icon: "ban" },
    { title: "Repeat Clients", value: `${Number(row.repeat_clients ?? 0).toFixed(2)}%`, description: "Clients having more than one completed appointment.", color: "purple", icon: "repeat" },
  ];
},

async getAppointmentTable(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const values: any[] = [salonId];
  const where = ["m.salon_id = $1"];
  let index = 2;

  if (filters.from) {
    where.push(`DATE(m.scheduled_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(m.scheduled_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${APPOINTMENT_BASE_CTES},
      service_rows AS (
        SELECT
          a.id AS appointment_id,
          COALESCE(svc.value->>'name', 'Service') AS service_name,
          NULLIF(TRIM(COALESCE(svc.value->>'staff_name', '')), '') AS staff_name,
          NULLIF(svc.value->>'staff_id', '') AS staff_id,
          NULLIF(svc.value->>'service_id', '') AS service_id
        FROM appointments a
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
          ON TRUE
      )
      SELECT
        m.id,
        inv.invoice_number_text AS appointment_no,
        m.scheduled_at,
        COALESCE(c.full_name, 'Walk-in Client') AS customer,
        COALESCE(c.phone_number, '') AS mobile,
        COALESCE(sr.staff_name, CONCAT(st.first_name, ' ', st.last_name), 'Unknown') AS stylist,
        COALESCE(sc.name, 'Others') AS department,
        COALESCE(sr.service_name, sv.name, 'Service') AS service,
        m.duration_minutes,
        ROUND(COALESCE(m.appointment_amount, 0), 2) AS amount,
        UPPER(COALESCE(m.payment_method, 'N/A')) AS payment,
        CASE
          WHEN m.status = 'cancelled' THEN 'Cancelled'
          WHEN m.status = 'no-show' THEN 'No Show'
          WHEN LOWER(m.payment_state) = 'paid' THEN 'Completed'
          WHEN LOWER(m.payment_state) = 'unpaid' THEN 'Pending'
          ELSE 'Pending'
        END AS status
      FROM metrics m
      LEFT JOIN LATERAL (
        SELECT (
          SELECT COUNT(*)
          FROM appointments a2
          WHERE a2.salon_id = m.salon_id
            AND (
              a2.created_at < m.created_at
              OR (a2.created_at = m.created_at AND a2.id <= m.id)
            )
        )::text AS invoice_number_text
      ) inv
        ON TRUE
      LEFT JOIN service_rows sr
        ON sr.appointment_id = m.id
      LEFT JOIN clients c
        ON c.id = m.client_id
      LEFT JOIN staff st
        ON st.id::text = COALESCE(sr.staff_id, m.staff_id::text)
      LEFT JOIN services sv
        ON sv.id::text = COALESCE(sr.service_id, m.service_id::text)
      LEFT JOIN service_categories sc
        ON sc.id = sv.category_id
      WHERE ${where.join(" AND ")}
      ORDER BY m.scheduled_at DESC, appointment_no DESC
      `,
      values
    )
  );

  return rows.map((row) => ({
    appointmentNo: row.appointment_no,
    date: row.scheduled_at,
    time: row.scheduled_at,
    customer: row.customer,
    mobile: row.mobile,
    stylist: String(row.stylist ?? "Unknown").trim() || "Unknown",
    department: row.department,
    service: row.service,
    duration: `${Number(row.duration_minutes ?? 0)} Min`,
    amount: Number(row.amount ?? 0),
    price: Number(row.amount ?? 0),
    payment: row.payment,
    status: row.status,
  }));
},

async getAppointmentDetailTable(
  salonId: string,
  filters: { from?: string; to?: string; dateType?: "appointment" | "booking"; statuses?: string[] }
) {
  const values: any[] = [salonId];
  const where = ["m.salon_id = $1"];
  let index = 2;

  const dateColumn = filters.dateType === "booking" ? "m.created_at" : "m.scheduled_at";

  if (filters.from) {
    where.push(`DATE(${dateColumn}) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    where.push(`DATE(${dateColumn}) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  if (filters.statuses && filters.statuses.length > 0) {
    where.push(`m.status::text = ANY($${index}::text[])`);
    values.push(filters.statuses);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${APPOINTMENT_BASE_CTES},
      service_rows AS (
        SELECT
          a.id AS appointment_id,
          COALESCE(svc.value->>'name', 'Service') AS service_name,
          NULLIF(TRIM(COALESCE(svc.value->>'staff_name', '')), '') AS staff_name,
          NULLIF(svc.value->>'staff_id', '') AS staff_id
        FROM appointments a
        LEFT JOIN LATERAL jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
          ON TRUE
      )
      SELECT
        m.id,
        TO_CHAR(m.scheduled_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS appointment_date,
        TO_CHAR(m.scheduled_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS appointment_time,
        TO_CHAR(m.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS booked_date,
        COALESCE(c.full_name, 'Walk-in Client') AS client_name,
        COALESCE(sr.service_name, sv.name, 'Service') AS service_name,
        COALESCE(sr.staff_name, CONCAT(st.first_name, ' ', st.last_name), 'Unknown') AS staff_name,
        m.status,
        m.duration_minutes,
        ROUND(COALESCE(m.appointment_amount, 0), 2) AS amount,
        UPPER(COALESCE(m.payment_method, 'N/A')) AS payment_method,
        CASE
          WHEN m.status::text = 'cancelled' THEN 'cancelled'
          WHEN m.status::text = 'no-show'   THEN 'no-show'
          WHEN m.status::text = 'deleted'   THEN 'deleted'
          WHEN m.status::text = 'paid'      THEN 'paid'
          WHEN m.status::text = 'partial'   THEN 'partial'
          ELSE 'unpaid'
        END AS payment_status
      FROM metrics m
      LEFT JOIN service_rows sr
        ON sr.appointment_id = m.id
      LEFT JOIN clients c
        ON c.id = m.client_id
      LEFT JOIN staff st
        ON st.id::text = COALESCE(sr.staff_id, m.staff_id::text)
      LEFT JOIN services sv
        ON sv.id::text = m.service_id::text
      WHERE ${where.join(" AND ")}
      ORDER BY ${dateColumn} DESC
      `,
      values
    )
  );

  return rows.map((row) => ({
    id: row.id,
    appointmentDate: row.appointment_date,
    time: row.appointment_time,
    bookedDate: row.booked_date,
    clientName: row.client_name,
    serviceName: row.service_name,
    staffName: String(row.staff_name ?? "Unknown").trim() || "Unknown",
    status: row.status,
    duration: Number(row.duration_minutes ?? 0),
    amount: Number(row.amount ?? 0),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
  }));
},

async getDailySheetTable(
  salonId: string,
  filters: { date: string; service?: string; staff?: string }
) {
  const values: any[] = [salonId, filters.date];
  const having: string[] = [];
  let index = 3;

  if (filters.service) {
    having.push(`sf.service ILIKE $${index}`);
    values.push(`%${filters.service}%`);
    index++;
  }

  if (filters.staff) {
    having.push(`sf.staff ILIKE $${index}`);
    values.push(`%${filters.staff}%`);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      WITH filtered_sales AS (
        SELECT * FROM sales
        WHERE salon_id = $1
          AND LOWER(COALESCE(status::text, '')) = 'completed'
          AND created_at >= $2::date AND created_at < ($2::date + interval '1 day')
      ),
      payment_rollup AS (
        SELECT
          p.appointment_id,
          MAX(p.payment_method) FILTER (
            WHERE p.created_at = (
              SELECT MAX(p2.created_at)
              FROM payments p2
              WHERE p2.appointment_id = p.appointment_id
            )
          ) AS latest_method
        FROM payments p
        WHERE p.appointment_id IS NOT NULL
        GROUP BY p.appointment_id
      ),
      sale_item_rollup AS (
        SELECT
          si.sale_id,
          COALESCE(STRING_AGG(DISTINCT si.name, ', ' ORDER BY si.name), '') AS items
        FROM sale_items si
        JOIN filtered_sales fs
          ON fs.id = si.sale_id
        GROUP BY si.sale_id
      ),
      appointment_item_rollup AS (
        SELECT
          a.id AS appointment_id,
          COALESCE((
            SELECT STRING_AGG(DISTINCT COALESCE(NULLIF(svc.value->>'name', ''), 'Service'), ', ')
            FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
          ), '') AS services
        FROM appointments a
        JOIN filtered_sales fs
          ON fs.appointment_id = a.id
      ),
      sale_staff_rollup AS (
        SELECT
          staff_lines.sale_id,
          COALESCE(
            STRING_AGG(DISTINCT staff_lines.staff_name, ', ' ORDER BY staff_lines.staff_name),
            'Unknown'
          ) AS staff_names
        FROM (
          SELECT
            s.id AS sale_id,
            COALESCE(
              NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''),
              'Unknown'
            ) AS staff_name
          FROM filtered_sales s
          LEFT JOIN sale_items si
            ON si.sale_id = s.id
          LEFT JOIN staff st
            ON st.id = COALESCE(si.staff_id, s.staff_id)
        ) staff_lines
        GROUP BY staff_lines.sale_id
      ),
      sales_final AS (
        SELECT
          s.id,
          s.appointment_id,
          s.created_at AS sort_ts,
          TO_CHAR(s.created_at AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM') AS time,
          s.invoice_number AS ticket_no,
          COALESCE(c.full_name, 'Walk-in Client') AS client_name,
          COALESCE(NULLIF(sir.items, ''), NULLIF(air.services, ''), 'Service') AS service,
          COALESCE(ssr.staff_names, 'Unknown') AS staff,
          COALESCE(s.total_amount::numeric, 0) AS amount,
          UPPER(COALESCE(pr.latest_method, s.payment_method, 'N/A')) AS payment_method
        FROM filtered_sales s
        LEFT JOIN clients c
          ON c.id = s.client_id
        LEFT JOIN payment_rollup pr
          ON pr.appointment_id = s.appointment_id
        LEFT JOIN sale_item_rollup sir
          ON sir.sale_id = s.id
        LEFT JOIN appointment_item_rollup air
          ON air.appointment_id = s.appointment_id
        LEFT JOIN sale_staff_rollup ssr
          ON ssr.sale_id = s.id
      )
      SELECT * FROM sales_final sf
      ${having.length > 0 ? "WHERE " + having.join(" AND ") : ""}
      ORDER BY sf.sort_ts ASC
      `,
      values
    )
  );

  return rows.map((row) => ({
    id: row.id,
    appointmentId: row.appointment_id,
    time: row.time,
    ticketNo: row.ticket_no,
    clientName: row.client_name,
    service: row.service,
    staff: row.staff,
    amount: Number(row.amount ?? 0),
    paymentMethod: row.payment_method,
  }));
},

async getRewardPointsSummary(
  salonId: string,
  filters: { search?: string }
) {
  const values: any[] = [salonId];
  const where = ["c.salon_id = $1"];
  let index = 2;

  if (filters.search) {
    where.push(`(c.full_name ILIKE $${index} OR c.phone_number ILIKE $${index})`);
    values.push(`%${filters.search}%`);
    index++;
  }

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      WITH ledger_rollup AS (
        SELECT
          client_id,
          COALESCE(SUM(points) FILTER (WHERE type = 'earn'), 0) AS total_earned,
          COALESCE(SUM(-points) FILTER (WHERE type = 'redeem'), 0) AS total_redeemed,
          MAX(created_at) AS last_activity_at
        FROM reward_points_ledger
        WHERE salon_id = $1
        GROUP BY client_id
      )
      SELECT
        c.id AS client_id,
        c.full_name,
        c.phone_number,
        COALESCE(c.reward_points_balance, 0) AS points_available,
        COALESCE(lr.total_earned, 0) AS points_earned,
        COALESCE(lr.total_redeemed, 0) AS points_redeemed,
        lr.last_activity_at
      FROM clients c
      LEFT JOIN ledger_rollup lr
        ON lr.client_id = c.id
      WHERE ${where.join(" AND ")}
        AND (
          COALESCE(c.reward_points_balance, 0) > 0
          OR COALESCE(lr.total_earned, 0) > 0
          OR COALESCE(lr.total_redeemed, 0) > 0
        )
      ORDER BY points_available DESC, points_redeemed DESC
      `,
      values
    )
  );

  return rows.map((row) => ({
    clientId: row.client_id,
    clientName: row.full_name || "Walk-in Client",
    mobile: row.phone_number || "—",
    pointsAvailable: Number(row.points_available ?? 0),
    pointsEarned: Number(row.points_earned ?? 0),
    pointsRedeemed: Number(row.points_redeemed ?? 0),
    lastActivityAt: row.last_activity_at,
  }));
},

async getAppointmentReport(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const [cards, charts, analytics, table] = await Promise.all([
    reportsRepository.getAppointmentCards(salonId, filters),
    reportsRepository.getAppointmentCharts(salonId, filters),
    reportsRepository.getAppointmentAnalytics(salonId, filters),
    reportsRepository.getAppointmentTable(salonId, filters),
  ]);

  return {
    cards,
    charts,
    analytics,
    table,
  };
},

async getServiceReminderReport(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const from = filters.from ?? new Date().toISOString().slice(0, 10);
  const to = filters.to ?? from;
  const values = [salonId, from, to];

  const cardsPromise = safeQuery(() =>
    pool.query(
      `
      ${SERVICE_REMINDER_BASE_CTES}
      SELECT
        COUNT(*) AS total_reminders,
        COUNT(*) FILTER (WHERE status = 'Sent') AS sent_reminders,
        COUNT(*) FILTER (WHERE status = 'Pending') AS pending_followups,
        COUNT(*) FILTER (WHERE status = 'Completed') AS completed_visits,
        COUNT(*) FILTER (WHERE status = 'Expired') AS expired_reminders,
        COALESCE(
          ROUND(
            (COUNT(*) FILTER (WHERE status = 'Completed')::numeric * 100)
            / NULLIF(COUNT(*), 0),
            1
          ),
          0
        ) AS conversion_rate
      FROM filtered
      `,
      values
    )
  );

  const reminderTrendPromise = safeQuery(() =>
    pool.query(
      `
      ${SERVICE_REMINDER_BASE_CTES}
      SELECT
        TO_CHAR(DATE_TRUNC('day', reminder_date), 'Dy') AS day,
        COUNT(*) FILTER (WHERE status = 'Sent') AS sent
      FROM filtered
      GROUP BY DATE_TRUNC('day', reminder_date)
      ORDER BY DATE_TRUNC('day', reminder_date)
      `,
      values
    )
  );

  const statusDistributionPromise = safeQuery(() =>
    pool.query(
      `
      ${SERVICE_REMINDER_BASE_CTES}
      SELECT
        status AS name,
        COUNT(*) AS value
      FROM filtered
      GROUP BY status
      ORDER BY value DESC, name ASC
      `,
      values
    )
  );

  const serviceBreakdownPromise = safeQuery(() =>
    pool.query(
      `
      ${SERVICE_REMINDER_BASE_CTES}
      SELECT
        COALESCE(service_name, 'Unknown') AS name,
        COUNT(*) AS value
      FROM filtered
      GROUP BY COALESCE(service_name, 'Unknown')
      ORDER BY value DESC, name ASC
      `,
      values
    )
  );

  const staffPerformancePromise = safeQuery(() =>
    pool.query(
      `
      ${SERVICE_REMINDER_BASE_CTES}
      SELECT
        COALESCE(staff_name, 'Unknown') AS name,
        COUNT(*) FILTER (WHERE status = 'Completed') AS value
      FROM filtered
      GROUP BY COALESCE(staff_name, 'Unknown')
      ORDER BY value DESC, name ASC
      LIMIT 10
      `,
      values
    )
  );

  const analyticsPromise = safeQuery(() =>
    pool.query(
      `
      ${SERVICE_REMINDER_BASE_CTES},
      best_day AS (
        SELECT
          TO_CHAR(DATE_TRUNC('day', reminder_date), 'FMDay') AS value
        FROM filtered
        WHERE status = 'Completed'
        GROUP BY DATE_TRUNC('day', reminder_date)
        ORDER BY COUNT(*) DESC, DATE_TRUNC('day', reminder_date) ASC
        LIMIT 1
      ),
      peak_hour AS (
        SELECT
          CONCAT(
            TO_CHAR(DATE_TRUNC('hour', message_at), 'FMHH12 AM'),
            ' - ',
            TO_CHAR(DATE_TRUNC('hour', message_at) + INTERVAL '2 hour', 'FMHH12 AM')
          ) AS value
        FROM filtered
        WHERE status = 'Completed' AND message_at IS NOT NULL
        GROUP BY DATE_TRUNC('hour', message_at)
        ORDER BY COUNT(*) DESC, DATE_TRUNC('hour', message_at) ASC
        LIMIT 1
      ),
      top_staff AS (
        SELECT
          COALESCE(staff_name, 'Unknown') AS value
        FROM filtered
        WHERE status = 'Completed'
        GROUP BY COALESCE(staff_name, 'Unknown')
        ORDER BY COUNT(*) DESC, value ASC
        LIMIT 1
      ),
      top_service AS (
        SELECT
          COALESCE(service_name, 'Unknown') AS value
        FROM filtered
        WHERE status = 'Completed'
        GROUP BY COALESCE(service_name, 'Unknown')
        ORDER BY COUNT(*) DESC, value ASC
        LIMIT 1
      ),
      conversion AS (
        SELECT
          COALESCE(
            ROUND(
              (COUNT(*) FILTER (WHERE status = 'Completed')::numeric * 100)
              / NULLIF(COUNT(*), 0),
              1
            ),
            0
          ) AS value
        FROM filtered
      ),
      repeat_rate AS (
        SELECT
          COALESCE(
            ROUND(
              (COUNT(*) FILTER (WHERE completed_reminders > 1)::numeric * 100)
              / NULLIF(COUNT(*), 0),
              0
            ),
            0
          ) AS value
        FROM reminder_counts
      )
      SELECT
        COALESCE((SELECT value FROM best_day), '-') AS best_reminder_day,
        COALESCE((SELECT value FROM peak_hour), '-') AS peak_response_time,
        COALESCE((SELECT value FROM top_staff), '-') AS top_staff_performer,
        COALESCE((SELECT value FROM top_service), '-') AS most_effective_service,
        COALESCE((SELECT value FROM conversion), 0) AS conversion_rate,
        COALESCE((SELECT value FROM repeat_rate), 0) AS repeat_booking_rate
      `,
      values
    )
  );

  const tablePromise = safeQuery(() =>
    pool.query(
      `
      ${SERVICE_REMINDER_BASE_CTES}
      SELECT
        id,
        client_id,
        customer_name,
        mobile,
        reference_type,
        event_type,
        template_name,
        COALESCE(service_name, 'Unknown') AS service_name,
        COALESCE(staff_name, 'Unknown') AS staff_name,
        reminder_date,
        follow_up_date,
        status,
        COALESCE(visits, 0) AS visits
      FROM filtered f
      ORDER BY reminder_date DESC, id DESC
      `,
      values
    )
  );

  const [
    cardsResult,
    reminderTrendResult,
    statusDistributionResult,
    serviceBreakdownResult,
    staffPerformanceResult,
    analyticsResult,
    tableResult,
  ] = await Promise.all([
    cardsPromise,
    reminderTrendPromise,
    statusDistributionPromise,
    serviceBreakdownPromise,
    staffPerformancePromise,
    analyticsPromise,
    tablePromise,
  ]);

  const cardsRow = cardsResult.rows[0] ?? {};
  const analyticsRow = analyticsResult.rows[0] ?? {};

  return {
    cards: [
      { title: "Total Reminders", value: String(cardsRow.total_reminders ?? 0), trend: "0.0%", color: "primary" },
      { title: "Sent Reminders", value: String(cardsRow.sent_reminders ?? 0), trend: "0.0%", color: "success" },
      { title: "Pending Follow-ups", value: String(cardsRow.pending_followups ?? 0), trend: "0.0%", color: "warning" },
      { title: "Completed Visits", value: String(cardsRow.completed_visits ?? 0), trend: "0.0%", color: "success" },
      { title: "Expired Reminders", value: String(cardsRow.expired_reminders ?? 0), trend: "0.0%", color: "danger" },
      { title: "Conversion Rate", value: `${Number(cardsRow.conversion_rate ?? 0).toFixed(1)}%`, trend: "0.0%", color: "purple" },
    ],
    charts: {
      reminderTrend: reminderTrendResult.rows.map((row) => ({
        day: row.day,
        sent: Number(row.sent ?? 0),
      })),
      statusDistribution: statusDistributionResult.rows.map((row) => ({
        name: row.name,
        value: Number(row.value ?? 0),
      })),
      serviceBreakdown: serviceBreakdownResult.rows.map((row) => ({
        name: row.name,
        value: Number(row.value ?? 0),
      })),
      staffPerformance: staffPerformanceResult.rows.map((row) => ({
        name: row.name,
        value: Number(row.value ?? 0),
      })),
    },
    analytics: [
      { title: "Best Reminder Day", value: analyticsRow.best_reminder_day ?? "-", description: "Highest customer response rate", color: "primary" },
      { title: "Peak Response Time", value: analyticsRow.peak_response_time ?? "-", description: "Maximum engagement window", color: "warning" },
      { title: "Top Staff Performer", value: analyticsRow.top_staff_performer ?? "-", description: "Most successful follow-ups", color: "success" },
      { title: "Most Effective Service", value: analyticsRow.most_effective_service ?? "-", description: "Highest conversion after reminders", color: "purple" },
      { title: "Conversion Rate", value: `${Number(analyticsRow.conversion_rate ?? 0).toFixed(1)}%`, description: "Reminders converted to visits", color: "info" },
      { title: "Repeat Booking Rate", value: `${Number(analyticsRow.repeat_booking_rate ?? 0).toFixed(0)}%`, description: "Customers returning after reminders", color: "success" },
    ],
    table: tableResult.rows.map((row, index) => ({
      reminderNo: `REM-${1001 + index}`,
      customer: row.customer_name ?? "Walk-in Client",
      mobile: row.mobile ?? "",
      service: row.service_name ?? "Unknown",
      staff: row.staff_name ?? "Unknown",
      source: "WhatsApp",
      message: row.template_name ?? row.event_type ?? row.reference_type ?? "Reminder",
      reminderDate: row.reminder_date,
      followUpDate: row.follow_up_date,
      status: row.status,
      visits: Number(row.visits ?? 0),
    })),
  };
},

async getGuestCollectionReport(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const from = filters.from ?? new Date().toISOString().slice(0, 10);
  const to = filters.to ?? from;

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const diffDays = Math.max(
    1,
    Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );
  const prevToDate = new Date(fromDate);
  prevToDate.setUTCDate(prevToDate.getUTCDate() - 1);
  const prevFromDate = new Date(prevToDate);
  prevFromDate.setUTCDate(prevFromDate.getUTCDate() - diffDays + 1);

  const prevFrom = prevFromDate.toISOString().slice(0, 10);
  const prevTo = prevToDate.toISOString().slice(0, 10);

  const values = [salonId, from, to, prevFrom, prevTo];

  const GUEST_COLLECTION_BASE_CTES = `
    ${APPOINTMENT_BASE_CTES},
    payment_rollup AS (
      SELECT
        p.appointment_id,
        COALESCE(SUM(p.paid_amount) FILTER (
          WHERE p.status IN ('partial', 'completed')
        ), 0)::numeric AS paid_amount,
        COALESCE(MAX(p.due_amount) FILTER (
          WHERE p.created_at = (
            SELECT MAX(p2.created_at)
            FROM payments p2
            WHERE p2.appointment_id = p.appointment_id
          )
        ), 0)::numeric AS pending_amount,
        MAX(p.payment_method) FILTER (
          WHERE p.created_at = (
            SELECT MAX(p2.created_at)
            FROM payments p2
            WHERE p2.appointment_id = p.appointment_id
          )
        ) AS latest_payment_method,
        MAX(COALESCE(p.paid_at, p.created_at)) FILTER (
          WHERE p.status IN ('partial', 'completed')
        ) AS last_paid_at
      FROM payments p
      WHERE p.appointment_id IS NOT NULL
      GROUP BY p.appointment_id
    ),
    sale_item_rollup AS (
      SELECT
        si.sale_id,
        COALESCE(SUM(si.quantity) FILTER (WHERE si.item_type = 'service'), 0) AS service_count,
        COALESCE(SUM(si.quantity) FILTER (WHERE si.item_type = 'product'), 0) AS product_count,
        COALESCE(SUM(si.quantity) FILTER (WHERE si.item_type = 'membership'), 0) AS membership_count,
        COALESCE(SUM(si.quantity) FILTER (WHERE si.item_type = 'package'), 0) AS package_count,
        COALESCE(
          STRING_AGG(
            CASE WHEN si.item_type = 'service' THEN CONCAT(si.name, ' x', si.quantity) END,
            ', ' ORDER BY si.created_at, si.name
          ),
          ''
        ) AS services,
        COALESCE(
          STRING_AGG(
            CASE WHEN si.item_type = 'product' THEN CONCAT(si.name, ' x', si.quantity) END,
            ', ' ORDER BY si.created_at, si.name
          ),
          ''
        ) AS products,
        COALESCE(
          STRING_AGG(
            CASE WHEN si.item_type = 'membership' THEN CONCAT(si.name, ' x', si.quantity) END,
            ', ' ORDER BY si.created_at, si.name
          ),
          ''
        ) AS memberships,
        COALESCE(
          STRING_AGG(
            CASE WHEN si.item_type = 'package' THEN CONCAT(si.name, ' x', si.quantity) END,
            ', ' ORDER BY si.created_at, si.name
          ),
          ''
        ) AS packages
      FROM sale_items si
      GROUP BY si.sale_id
    ),
    appointment_items AS (
      SELECT
        m.id AS appointment_id,
        'service'::text AS item_type,
        COALESCE(NULLIF(svc.value->>'name', ''), 'Service') AS item_name,
        COALESCE(NULLIF(svc.value->>'qty', '')::int, NULLIF(svc.value->>'quantity', '')::int, 1) AS quantity
      FROM metrics m
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(m.services, '[]'::jsonb)) AS svc(value)
        ON TRUE
      WHERE svc.value IS NOT NULL

      UNION ALL

      SELECT
        m.id AS appointment_id,
        'product'::text AS item_type,
        COALESCE(NULLIF(prod.value->>'name', ''), 'Product') AS item_name,
        COALESCE(NULLIF(prod.value->>'qty', '')::int, NULLIF(prod.value->>'quantity', '')::int, 1) AS quantity
      FROM metrics m
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(m.product_items, '[]'::jsonb)) AS prod(value)
        ON TRUE
      WHERE prod.value IS NOT NULL

      UNION ALL

      SELECT
        m.id AS appointment_id,
        'package'::text AS item_type,
        COALESCE(NULLIF(pkg.value->>'name', ''), 'Package') AS item_name,
        COALESCE(NULLIF(pkg.value->>'qty', '')::int, NULLIF(pkg.value->>'quantity', '')::int, 1) AS quantity
      FROM metrics m
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(m.package_items, '[]'::jsonb)) AS pkg(value)
        ON TRUE
      WHERE pkg.value IS NOT NULL

      UNION ALL

      SELECT
        m.id AS appointment_id,
        'membership'::text AS item_type,
        COALESCE(NULLIF(mem.value->>'name', ''), 'Membership') AS item_name,
        COALESCE(NULLIF(mem.value->>'qty', '')::int, NULLIF(mem.value->>'quantity', '')::int, 1) AS quantity
      FROM metrics m
      LEFT JOIN LATERAL jsonb_array_elements(COALESCE(m.membership_items, '[]'::jsonb)) AS mem(value)
        ON TRUE
      WHERE mem.value IS NOT NULL
    ),
    appointment_item_rollup AS (
      SELECT
        ai.appointment_id,
        COALESCE(SUM(ai.quantity) FILTER (WHERE ai.item_type = 'service'), 0) AS service_count,
        COALESCE(SUM(ai.quantity) FILTER (WHERE ai.item_type = 'product'), 0) AS product_count,
        COALESCE(SUM(ai.quantity) FILTER (WHERE ai.item_type = 'membership'), 0) AS membership_count,
        COALESCE(SUM(ai.quantity) FILTER (WHERE ai.item_type = 'package'), 0) AS package_count,
        COALESCE(
          STRING_AGG(
            CASE WHEN ai.item_type = 'service' THEN CONCAT(ai.item_name, ' x', ai.quantity) END,
            ', ' ORDER BY ai.item_name
          ),
          ''
        ) AS services,
        COALESCE(
          STRING_AGG(
            CASE WHEN ai.item_type = 'product' THEN CONCAT(ai.item_name, ' x', ai.quantity) END,
            ', ' ORDER BY ai.item_name
          ),
          ''
        ) AS products,
        COALESCE(
          STRING_AGG(
            CASE WHEN ai.item_type = 'membership' THEN CONCAT(ai.item_name, ' x', ai.quantity) END,
            ', ' ORDER BY ai.item_name
          ),
          ''
        ) AS memberships,
        COALESCE(
          STRING_AGG(
            CASE WHEN ai.item_type = 'package' THEN CONCAT(ai.item_name, ' x', ai.quantity) END,
            ', ' ORDER BY ai.item_name
          ),
          ''
        ) AS packages
      FROM appointment_items ai
      GROUP BY ai.appointment_id
    ),
    appointment_base AS (
      SELECT
        m.id,
        m.id AS source_ref_id,
        'appointment'::text AS source_type,
        s.invoice_number AS invoice_number,
        m.client_id,
        COALESCE(s.created_at, m.created_at, m.scheduled_at) AS created_at,
        DATE(COALESCE(s.created_at, m.scheduled_at, m.created_at) AT TIME ZONE 'Asia/Kolkata') AS bill_date,
        COALESCE(c.full_name, 'Walk-in Client') AS guest_name,
        COALESCE(c.phone_number, '') AS phone,
        COALESCE(m.appointment_amount, 0)::numeric AS bill_amount,
        CASE
          WHEN LOWER(COALESCE(m.payment_state, '')) = 'paid' AND COALESCE(pr.paid_amount, 0) = 0
          THEN COALESCE(m.appointment_amount, 0)::numeric
          ELSE COALESCE(pr.paid_amount, 0)::numeric
        END AS paid_amount,
        CASE
          WHEN LOWER(COALESCE(m.payment_state, '')) = 'paid' THEN 0::numeric
          WHEN pr.appointment_id IS NOT NULL
          THEN GREATEST(
            COALESCE(pr.pending_amount, COALESCE(m.appointment_amount, 0) - COALESCE(pr.paid_amount, 0)),
            0
          )::numeric
          ELSE GREATEST(COALESCE(m.appointment_amount, 0), 0)::numeric
        END AS pending_amount,
        COALESCE(pr.last_paid_at, s.created_at, m.created_at, m.scheduled_at) AS cleared_at,
        COALESCE(pr.latest_payment_method, s.payment_method, m.payment_method, 'cash') AS payment_mode_raw,
        COALESCE(NULLIF(LOWER(COALESCE(s.status::text, '')), ''), LOWER(COALESCE(m.payment_state, 'unpaid'))) AS raw_status,
        COALESCE(NULLIF(sir.service_count, 0), air.service_count, 0) AS service_count,
        COALESCE(NULLIF(sir.product_count, 0), air.product_count, 0) AS product_count,
        COALESCE(NULLIF(sir.membership_count, 0), air.membership_count, 0) AS membership_count,
        COALESCE(NULLIF(sir.package_count, 0), air.package_count, 0) AS package_count,
        COALESCE(NULLIF(sir.services, ''), air.services, '') AS services,
        COALESCE(NULLIF(sir.products, ''), air.products, '') AS products,
        COALESCE(NULLIF(sir.memberships, ''), air.memberships, '') AS memberships,
        COALESCE(NULLIF(sir.packages, ''), air.packages, '') AS packages
      FROM metrics m
      LEFT JOIN sales s
        ON s.appointment_id = m.id
      LEFT JOIN payment_rollup pr
        ON pr.appointment_id = m.id
      LEFT JOIN appointment_item_rollup air
        ON air.appointment_id = m.id
      LEFT JOIN sale_item_rollup sir
        ON sir.sale_id = s.id
      LEFT JOIN clients c
        ON c.id = m.client_id
      WHERE
        m.salon_id = $1
        AND LOWER(COALESCE(m.status::text, '')) NOT IN ('cancelled', 'no-show')
    ),
    standalone_sales_base AS (
      SELECT
        s.id,
        s.id AS source_ref_id,
        'sale'::text AS source_type,
        s.invoice_number AS invoice_number,
        s.client_id,
        s.created_at,
        DATE(s.created_at AT TIME ZONE 'Asia/Kolkata') AS bill_date,
        COALESCE(c.full_name, 'Walk-in Client') AS guest_name,
        COALESCE(c.phone_number, '') AS phone,
        COALESCE(s.total_amount::numeric, 0) AS bill_amount,
        CASE
          WHEN LOWER(COALESCE(s.status::text, '')) = 'completed' THEN COALESCE(s.total_amount::numeric, 0)
          ELSE 0::numeric
        END AS paid_amount,
        CASE
          WHEN LOWER(COALESCE(s.status::text, '')) = 'draft' THEN COALESCE(s.total_amount::numeric, 0)
          ELSE 0::numeric
        END AS pending_amount,
        s.created_at AS cleared_at,
        COALESCE(s.payment_method, 'cash') AS payment_mode_raw,
        LOWER(COALESCE(s.status::text, 'draft')) AS raw_status,
        COALESCE(sir.service_count, 0) AS service_count,
        COALESCE(sir.product_count, 0) AS product_count,
        COALESCE(sir.membership_count, 0) AS membership_count,
        COALESCE(sir.package_count, 0) AS package_count,
        COALESCE(sir.services, '') AS services,
        COALESCE(sir.products, '') AS products,
        COALESCE(sir.memberships, '') AS memberships,
        COALESCE(sir.packages, '') AS packages
      FROM sales s
      LEFT JOIN sale_item_rollup sir
        ON sir.sale_id = s.id
      LEFT JOIN clients c
        ON c.id = s.client_id
      WHERE
        s.salon_id = $1
        AND s.appointment_id IS NULL
        AND LOWER(COALESCE(s.status::text, '')) IN ('draft', 'completed', 'refunded')
    ),
    base AS (
      SELECT * FROM appointment_base
      UNION ALL
      SELECT * FROM standalone_sales_base
    ),
    normalized AS (
      SELECT
        base.*,
        CASE
          WHEN LOWER(COALESCE(payment_mode_raw, '')) = 'upi' THEN 'UPI'
          WHEN LOWER(COALESCE(payment_mode_raw, '')) = 'cash' THEN 'Cash'
          WHEN LOWER(COALESCE(payment_mode_raw, '')) = 'card' THEN 'Card'
          WHEN LOWER(COALESCE(payment_mode_raw, '')) = 'wallet' THEN 'Wallet'
          WHEN LOWER(COALESCE(payment_mode_raw, '')) = 'bank_transfer' THEN 'Bank Transfer'
          WHEN LOWER(COALESCE(payment_mode_raw, '')) = 'gift_card' THEN 'Wallet'
          WHEN LOWER(COALESCE(payment_mode_raw, '')) = 'split' THEN 'Online'
          ELSE UPPER(COALESCE(payment_mode_raw, 'N/A'))
        END AS payment_mode,
        CASE
          WHEN raw_status = 'refunded' THEN 'Refunded'
          WHEN pending_amount <= 0 AND paid_amount > 0 THEN 'Paid'
          WHEN pending_amount > 0 AND paid_amount > 0 AND bill_date < CURRENT_DATE THEN 'Overdue'
          WHEN pending_amount > 0 AND paid_amount > 0 THEN 'Partial'
          WHEN pending_amount > 0 AND bill_date < CURRENT_DATE THEN 'Overdue'
          WHEN pending_amount > 0 THEN 'Pending'
          ELSE 'Paid'
        END AS payment_status
      FROM base
    ),
    current_period AS (
      SELECT *
      FROM normalized
      WHERE bill_date >= $2 AND bill_date <= $3
    ),
    previous_period AS (
      SELECT *
      FROM normalized
      WHERE bill_date >= $4 AND bill_date <= $5
    )
  `;

  const summaryPromise = safeQuery(() =>
    pool.query(
      `
      ${GUEST_COLLECTION_BASE_CTES}
      SELECT
        COALESCE(SUM(paid_amount), 0) AS total_collection,
        COALESCE(SUM(pending_amount), 0) AS pending_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'Overdue' THEN pending_amount ELSE 0 END), 0) AS overdue_amount,
        COALESCE(SUM(CASE WHEN payment_mode = 'Cash' THEN paid_amount ELSE 0 END), 0) AS cash_collection,
        COALESCE(SUM(CASE WHEN payment_mode IN ('UPI', 'Card', 'Wallet', 'Bank Transfer', 'Online') THEN paid_amount ELSE 0 END), 0) AS online_collection,
        COALESCE((SELECT SUM(paid_amount) FROM previous_period), 0) AS previous_collection,
        COALESCE(AVG(bill_amount), 0) AS avg_bill_value
      FROM current_period
      `,
      values
    )
  );

  const trendPromise = safeQuery(() =>
    pool.query(
      `
      ${GUEST_COLLECTION_BASE_CTES}
      SELECT
        TO_CHAR(bill_date, 'Dy') AS day,
        COALESCE(SUM(paid_amount), 0) AS amount
      FROM current_period
      GROUP BY bill_date
      ORDER BY bill_date
      `,
      values
    )
  );

  const modePromise = safeQuery(() =>
    pool.query(
      `
      ${GUEST_COLLECTION_BASE_CTES}
      SELECT
        payment_mode AS name,
        COALESCE(ROUND(
          (SUM(paid_amount) * 100.0) / NULLIF((SELECT SUM(paid_amount) FROM current_period), 0),
          0
        ), 0) AS value
      FROM current_period
      GROUP BY payment_mode
      ORDER BY SUM(paid_amount) DESC, payment_mode ASC
      `,
      values
    )
  );

  const statusPromise = safeQuery(() =>
    pool.query(
      `
      ${GUEST_COLLECTION_BASE_CTES}
      SELECT
        payment_status AS name,
        COALESCE(SUM(
          CASE
            WHEN payment_status = 'Paid' THEN paid_amount
            ELSE pending_amount
          END
        ), 0) AS value
      FROM current_period
      GROUP BY payment_status
      ORDER BY
        CASE payment_status
          WHEN 'Paid' THEN 1
          WHEN 'Pending' THEN 2
          WHEN 'Partial' THEN 3
          WHEN 'Overdue' THEN 4
          WHEN 'Refunded' THEN 5
          ELSE 6
        END
      `,
      values
    )
  );

  const analyticsPromise = safeQuery(() =>
    pool.query(
      `
      ${GUEST_COLLECTION_BASE_CTES},
      top_guest AS (
        SELECT guest_name AS value
        FROM current_period
        GROUP BY guest_name
        ORDER BY SUM(paid_amount) DESC, guest_name ASC
        LIMIT 1
      ),
      avg_time AS (
        SELECT
          COALESCE(
            ROUND(AVG(
              GREATEST(
                EXTRACT(EPOCH FROM (cleared_at - created_at)) / 86400,
                0
              )
            ), 1),
            0
          ) AS value
        FROM current_period
        WHERE paid_amount > 0 AND pending_amount <= 0
      ),
      risk AS (
        SELECT
          CASE
            WHEN COALESCE(
              SUM(pending_amount) / NULLIF(SUM(bill_amount), 0),
              0
            ) < 0.10 THEN 'Low'
            WHEN COALESCE(
              SUM(pending_amount) / NULLIF(SUM(bill_amount), 0),
              0
            ) <= 0.30 THEN 'Medium'
            ELSE 'High'
          END AS value
        FROM current_period
      ),
      recovery AS (
        SELECT
          COALESCE(
            ROUND(
              (SUM(paid_amount) * 100.0) / NULLIF(SUM(bill_amount), 0),
              1
            ),
            0
          ) AS value
        FROM current_period
      ),
      top_service AS (
        SELECT item_name AS value
        FROM (
          SELECT ai.item_name, ai.quantity
          FROM current_period cp
          JOIN appointment_items ai
            ON cp.source_type = 'appointment'
           AND ai.appointment_id = cp.source_ref_id
          WHERE ai.item_type = 'service'

          UNION ALL

          SELECT si.name AS item_name, si.quantity
          FROM current_period cp
          JOIN sale_items si
            ON cp.source_type = 'sale'
           AND si.sale_id = cp.source_ref_id
          WHERE si.item_type = 'service'
        ) service_lines
        GROUP BY item_name
        ORDER BY SUM(quantity) DESC, item_name ASC
        LIMIT 1
      )
      SELECT
        COALESCE((SELECT value FROM top_guest), '-') AS top_guest,
        COALESCE((SELECT value FROM avg_time), 0) AS avg_collection_time,
        COALESCE((SELECT value FROM risk), 'Low') AS risk_score,
        COALESCE((SELECT value FROM recovery), 0) AS recovery_rate,
        COALESCE((SELECT value FROM top_service), '-') AS top_service,
        COALESCE((SELECT AVG(bill_amount) FROM current_period), 0) AS avg_bill_value
      `,
      values
    )
  );

  const tablePromise = safeQuery(() =>
    pool.query(
      `
      ${GUEST_COLLECTION_BASE_CTES}
      SELECT
        invoice_number AS invoice_no,
        guest_name,
        phone,
        bill_amount,
        paid_amount,
        pending_amount,
        payment_mode,
        payment_status,
        bill_date,
        service_count,
        product_count,
        package_count,
        membership_count,
        services,
        products,
        packages,
        memberships
      FROM current_period
      ORDER BY bill_date DESC, created_at DESC
      `,
      values
    )
  );

  const [
    summaryResult,
    trendResult,
    modeResult,
    statusResult,
    analyticsResult,
    tableResult,
  ] = await Promise.all([
    summaryPromise,
    trendPromise,
    modePromise,
    statusPromise,
    analyticsPromise,
    tablePromise,
  ]);

  const summary = summaryResult.rows[0] ?? {};
  const analytics = analyticsResult.rows[0] ?? {};

  const currentCollection = Number(summary.total_collection ?? 0);
  const previousCollection = Number(summary.previous_collection ?? 0);
  const pendingAmount = Number(summary.pending_amount ?? 0);
  const overdueAmount = Number(summary.overdue_amount ?? 0);
  const cashCollection = Number(summary.cash_collection ?? 0);
  const onlineCollection = Number(summary.online_collection ?? 0);
  const totalSplit = cashCollection + onlineCollection;
  const cashRatio = totalSplit > 0 ? Math.round((cashCollection * 100) / totalSplit) : 0;
  const onlineRatio = totalSplit > 0 ? Math.round((onlineCollection * 100) / totalSplit) : 0;
  const growthRate = previousCollection > 0
    ? ((currentCollection - previousCollection) / previousCollection) * 100
    : 0;

  const formatCurrency = (value: number) => `₹ ${Math.round(value).toLocaleString("en-IN")}`;
  const formatTrend = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
  const formatDisplayCurrency = (value: number) => `₹ ${Math.round(value).toLocaleString("en-IN")}`;

  return {
    cards: [
      {
        title: "Total Collection",
        value: formatCurrency(currentCollection),
        trend: formatTrend(growthRate),
        color: "success",
      },
      {
        title: "Pending Amount",
        value: formatCurrency(pendingAmount),
        trend: "0.0%",
        color: "warning",
      },
      {
        title: "Overdue Payments",
        value: formatCurrency(overdueAmount),
        trend: "0.0%",
        color: "danger",
      },
      {
        title: "Cash vs Online",
        value: `${cashRatio} : ${onlineRatio}`,
        trend: "0.0%",
        color: "info",
      },
      {
        title: "Growth Rate",
        value: `${growthRate.toFixed(1)}%`,
        trend: formatTrend(growthRate),
        color: "purple",
      },
    ],
    charts: {
      collectionTrend: trendResult.rows.map((row) => ({
        day: row.day,
        amount: Number(row.amount ?? 0),
      })),
      paymentModeDistribution: modeResult.rows.map((row) => ({
        name: row.name,
        value: Number(row.value ?? 0),
      })),
      branchCollection: [],
      paymentStatus: statusResult.rows.map((row) => ({
        name: row.name,
        value: Number(row.value ?? 0),
      })),
    },
    analytics: [
      {
        title: "Top Paying Guest",
        value: analytics.top_guest ?? "-",
        description: "Highest lifetime payments",
        color: "success",
      },
      {
        title: "Avg Collection Time",
        value: `${Number(analytics.avg_collection_time ?? 0).toFixed(1)} Days`,
        description: "Average payment clearance time",
        color: "info",
      },
      {
        title: "Outstanding Risk Score",
        value: analytics.risk_score ?? "Low",
        description: "Risk based on pending dues",
        color: "warning",
      },
      {
        title: "Monthly Recovery Rate",
        value: `${Number(analytics.recovery_rate ?? 0).toFixed(1)}%`,
        description: "Recovered from pending bills",
        color: "primary",
      },
      {
        title: "Best Branch",
        value: "-",
        description: "Highest collection performance",
        color: "purple",
      },
      {
        title: "Avg Bill Value",
        value: formatDisplayCurrency(Number(analytics.avg_bill_value ?? 0)),
        description: "Average guest transaction value",
        color: "success",
      },
    ],
    table: tableResult.rows.map((row) => ({
      invoiceNo: row.invoice_no,
      guest: row.guest_name,
      phone: row.phone ?? "",
      amount: formatCurrency(Number(row.bill_amount ?? 0)),
      paid: formatCurrency(Number(row.paid_amount ?? 0)),
      pending: formatCurrency(Number(row.pending_amount ?? 0)),
      paymentMode: row.payment_mode,
      status: row.payment_status,
      date: new Date(row.bill_date).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      serviceCount: Number(row.service_count ?? 0),
      productCount: Number(row.product_count ?? 0),
      packageCount: Number(row.package_count ?? 0),
      membershipCount: Number(row.membership_count ?? 0),
      services: row.services ?? "",
      products: row.products ?? "",
      packages: row.packages ?? "",
      memberships: row.memberships ?? "",
    })),
  };
},

async getStaffAttendanceReport(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const from = filters.from ?? new Date().toISOString().slice(0, 10);
  const to = filters.to ?? from;

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const diffDays = Math.max(
    1,
    Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );
  const prevToDate = new Date(fromDate);
  prevToDate.setUTCDate(prevToDate.getUTCDate() - 1);
  const prevFromDate = new Date(prevToDate);
  prevFromDate.setUTCDate(prevFromDate.getUTCDate() - diffDays + 1);

  const prevFrom = prevFromDate.toISOString().slice(0, 10);
  const prevTo = prevToDate.toISOString().slice(0, 10);

  const values = [salonId, from, to, prevFrom, prevTo];

  const STAFF_ATTENDANCE_BASE_CTES = `
    WITH active_staff AS (
      SELECT
        st.id,
        st.employee_code,
        TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))) AS staff_name,
        COALESCE(st.designation, 'General') AS department,
        COALESCE(br.name, 'Main Branch') AS branch_name
      FROM staff st
      LEFT JOIN branches br
        ON br.id = st.branch_id
      WHERE
        st.salon_id = $1
        AND st.is_active = true
    ),
    attendance_range AS (
      SELECT
        a.id,
        a.staff_id,
        a.date AS attendance_date,
        a.check_in,
        a.check_out,
        a.hours_worked,
        a.status,
        s.employee_code,
        s.staff_name,
        s.department,
        s.branch_name
      FROM attendance a
      JOIN active_staff s
        ON s.id = a.staff_id
      WHERE
        a.salon_id = $1
        AND a.date >= $2::date
        AND a.date <= $3::date
    ),
    previous_range AS (
      SELECT
        a.staff_id,
        a.date AS attendance_date,
        a.status
      FROM attendance a
      JOIN active_staff s
        ON s.id = a.staff_id
      WHERE
        a.salon_id = $1
        AND a.date >= $4::date
        AND a.date <= $5::date
    ),
    appointment_counts AS (
      SELECT
        a.staff_id,
        -- Must stay attendance.date's calendar day (IST, see attendance_range
        -- above), not the UTC session's — otherwise a late-evening IST
        -- appointment near the UTC day rollover joins to the wrong
        -- attendance_date below and silently drops out of that staff's count.
        DATE(a.scheduled_at AT TIME ZONE 'Asia/Kolkata') AS appointment_date,
        COUNT(*) FILTER (WHERE a.status = 'paid') AS completed_appointments
      FROM appointments a
      JOIN active_staff s
        ON s.id = a.staff_id
      WHERE
        a.salon_id = $1
        AND DATE(a.scheduled_at) >= $2::date
        AND DATE(a.scheduled_at) <= $3::date
      GROUP BY a.staff_id, DATE(a.scheduled_at AT TIME ZONE 'Asia/Kolkata')
    ),
    merged AS (
      SELECT
        ar.*,
        COALESCE(ac.completed_appointments, 0) AS completed_appointments,
        CASE
          WHEN ar.check_in IS NULL THEN 0
          ELSE GREATEST(
            ROUND(
              EXTRACT(
                EPOCH FROM (
                  ar.check_in
                  - DATE_TRUNC('day', ar.check_in)
                  - INTERVAL '9 hour'
                )
              ) / 60
            ),
            0
          )::int
        END AS late_by_minutes,
        GREATEST(
          COALESCE(ROUND((COALESCE(ar.hours_worked, 0) - 9) * 60), 0),
          0
        )::int AS overtime_minutes
      FROM attendance_range ar
      LEFT JOIN appointment_counts ac
        ON ac.staff_id = ar.staff_id
       AND ac.appointment_date = ar.attendance_date
    )
  `;

  const cardsPromise = safeQuery(() =>
    pool.query(
      `
      ${STAFF_ATTENDANCE_BASE_CTES},
      current_stats AS (
        SELECT
          COUNT(*) FILTER (WHERE status = 'present') AS present_days,
          COUNT(*) FILTER (WHERE status = 'absent') AS absent_days,
          COUNT(*) FILTER (WHERE status = 'late') AS late_days,
          COUNT(*) FILTER (WHERE status IN ('present', 'absent', 'late', 'half_day')) AS tracked_days,
          COUNT(*) FILTER (WHERE status = 'present') + (COUNT(*) FILTER (WHERE status = 'half_day') * 0.5) AS attended_units,
          COALESCE(SUM(completed_appointments), 0) AS completed_appointments
        FROM merged
      ),
      previous_stats AS (
        SELECT
          COUNT(*) FILTER (WHERE status = 'present') AS present_days,
          COUNT(*) FILTER (WHERE status = 'absent') AS absent_days,
          COUNT(*) FILTER (WHERE status = 'late') AS late_days,
          COUNT(*) FILTER (WHERE status IN ('present', 'absent', 'late', 'half_day')) AS tracked_days,
          COUNT(*) FILTER (WHERE status = 'present') + (COUNT(*) FILTER (WHERE status = 'half_day') * 0.5) AS attended_units
        FROM previous_range
      )
      SELECT
        c.present_days,
        c.absent_days,
        c.late_days,
        COALESCE(ROUND((c.attended_units::numeric * 100) / NULLIF(c.tracked_days, 0), 1), 0) AS attendance_rate,
        COALESCE(ROUND((c.completed_appointments::numeric * 100) / NULLIF(c.present_days * 10, 0), 1), 0) AS productivity_score,
        p.present_days AS prev_present_days,
        p.absent_days AS prev_absent_days,
        p.late_days AS prev_late_days,
        COALESCE(ROUND((p.attended_units::numeric * 100) / NULLIF(p.tracked_days, 0), 1), 0) AS prev_attendance_rate,
        COALESCE(ROUND((c.completed_appointments::numeric * 100) / NULLIF(c.present_days * 10, 0), 1), 0) AS prev_productivity_score
      FROM current_stats c
      CROSS JOIN previous_stats p
      `,
      values
    )
  );

  const dailyAttendancePromise = safeQuery(() =>
    pool.query(
      `
      ${STAFF_ATTENDANCE_BASE_CTES}
      SELECT
        TO_CHAR(DATE_TRUNC('day', attendance_date), 'Dy') AS day,
        COUNT(*) FILTER (WHERE status = 'present') AS present,
        COUNT(*) FILTER (WHERE status = 'absent') AS absent
      FROM merged
      GROUP BY DATE_TRUNC('day', attendance_date)
      ORDER BY DATE_TRUNC('day', attendance_date)
      `,
      values
    )
  );

  const statusDistributionPromise = safeQuery(() =>
    pool.query(
      `
      ${STAFF_ATTENDANCE_BASE_CTES}
      SELECT
        CASE status
          WHEN 'present' THEN 'Present'
          WHEN 'absent' THEN 'Absent'
          WHEN 'late' THEN 'Late'
          WHEN 'half_day' THEN 'Half Day'
          WHEN 'on_leave' THEN 'Leave'
          ELSE INITCAP(status)
        END AS name,
        COUNT(*) AS value
      FROM merged
      GROUP BY status
      ORDER BY value DESC, name ASC
      `,
      values
    )
  );

  const departmentAttendancePromise = safeQuery(() =>
    pool.query(
      `
      ${STAFF_ATTENDANCE_BASE_CTES}
      SELECT
        department AS name,
        COUNT(*) FILTER (WHERE status = 'present') AS value
      FROM merged
      GROUP BY department
      ORDER BY value DESC, name ASC
      `,
      values
    )
  );

  const analyticsPromise = safeQuery(() =>
    pool.query(
      `
      ${STAFF_ATTENDANCE_BASE_CTES},
      punctual_staff AS (
        SELECT staff_name AS value
        FROM merged
        GROUP BY staff_id, staff_name
        ORDER BY
          COUNT(*) FILTER (WHERE status = 'late') ASC,
          COUNT(*) FILTER (WHERE status IN ('present', 'late', 'half_day')) DESC,
          staff_name ASC
        LIMIT 1
      ),
      avg_late AS (
        SELECT COALESCE(ROUND(AVG(late_by_minutes)), 0) AS value
        FROM merged
        WHERE status = 'late'
      ),
      absence_risk AS (
        SELECT
          CASE
            WHEN COALESCE((COUNT(*) FILTER (WHERE status = 'absent')::numeric * 100) / NULLIF(COUNT(*), 0), 0) < 5 THEN 'Low'
            WHEN COALESCE((COUNT(*) FILTER (WHERE status = 'absent')::numeric * 100) / NULLIF(COUNT(*), 0), 0) <= 10 THEN 'Medium'
            ELSE 'High'
          END AS value
        FROM merged
      ),
      attendance_growth AS (
        SELECT
          COALESCE(ROUND(
            (
              (
                (COUNT(*) FILTER (WHERE status = 'present') + (COUNT(*) FILTER (WHERE status = 'half_day') * 0.5))::numeric
                / NULLIF(COUNT(*) FILTER (WHERE status IN ('present', 'absent', 'late', 'half_day')), 0)
              )
              -
              (
                (SELECT (COUNT(*) FILTER (WHERE status = 'present') + (COUNT(*) FILTER (WHERE status = 'half_day') * 0.5))::numeric
                 FROM previous_range)
                / NULLIF((SELECT COUNT(*) FILTER (WHERE status IN ('present', 'absent', 'late', 'half_day')) FROM previous_range), 0)
              )
            ) * 100,
            1
          ), 0) AS value
        FROM merged
      ),
      best_department AS (
        SELECT department AS value
        FROM merged
        GROUP BY department
        ORDER BY
          (
            (COUNT(*) FILTER (WHERE status = 'present') + (COUNT(*) FILTER (WHERE status = 'half_day') * 0.5))::numeric
            / NULLIF(COUNT(*), 0)
          ) DESC,
          department ASC
        LIMIT 1
      ),
      top_performer AS (
        SELECT staff_name AS value
        FROM merged
        WHERE status IN ('present', 'late', 'half_day')
        GROUP BY staff_id, staff_name
        ORDER BY SUM(completed_appointments) DESC, staff_name ASC
        LIMIT 1
      )
      SELECT
        COALESCE((SELECT value FROM punctual_staff), '-') AS most_punctual_staff,
        COALESCE((SELECT value FROM avg_late), 0) AS avg_late_time,
        COALESCE((SELECT value FROM absence_risk), 'Low') AS absence_risk_level,
        COALESCE((SELECT value FROM attendance_growth), 0) AS attendance_growth,
        COALESCE((SELECT value FROM best_department), '-') AS best_department,
        COALESCE((SELECT value FROM top_performer), '-') AS top_performer
      `,
      values
    )
  );

  const tablePromise = safeQuery(() =>
    pool.query(
      `
      ${STAFF_ATTENDANCE_BASE_CTES}
      SELECT
        employee_code,
        staff_name,
        department,
        branch_name,
        attendance_date,
        check_in,
        check_out,
        hours_worked,
        late_by_minutes,
        overtime_minutes,
        completed_appointments,
        status
      FROM merged
      ORDER BY attendance_date DESC, staff_name ASC
      `,
      values
    )
  );

  const [
    cardsResult,
    dailyAttendanceResult,
    statusDistributionResult,
    departmentAttendanceResult,
    analyticsResult,
    tableResult,
  ] = await Promise.all([
    cardsPromise,
    dailyAttendancePromise,
    statusDistributionPromise,
    departmentAttendancePromise,
    analyticsPromise,
    tablePromise,
  ]);

  const row = cardsResult.rows[0] ?? {};
  const analytics = analyticsResult.rows[0] ?? {};

  const trend = (current: number, previous: number) => {
    if (!previous) return "0.0%";
    const change = ((current - previous) / previous) * 100;
    return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
  };

  const formatMinutes = (minutes: number) => `${Math.round(minutes)} Min`;
  const formatHours = (hours: number | null) => {
    const totalMinutes = Math.max(0, Math.round(Number(hours ?? 0) * 60));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}h ${m}m`;
  };
  const formatTime = (value: string | null) => {
    if (!value) return "-";
    return new Date(value).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };
  const formatAttendance = (status: string) => {
    switch (status) {
      case "present": return "Present";
      case "absent": return "Absent";
      case "late": return "Late";
      case "half_day": return "Half Day";
      case "on_leave": return "Leave";
      default: return status;
    }
  };

  return {
    cards: [
      {
        title: "Total Present Days",
        value: String(Number(row.present_days ?? 0)),
        trend: trend(Number(row.present_days ?? 0), Number(row.prev_present_days ?? 0)),
        color: "success",
      },
      {
        title: "Total Absents",
        value: String(Number(row.absent_days ?? 0)),
        trend: trend(Number(row.absent_days ?? 0), Number(row.prev_absent_days ?? 0)),
        color: "danger",
      },
      {
        title: "Late Check-ins",
        value: String(Number(row.late_days ?? 0)),
        trend: trend(Number(row.late_days ?? 0), Number(row.prev_late_days ?? 0)),
        color: "warning",
      },
      {
        title: "Attendance Rate",
        value: `${Number(row.attendance_rate ?? 0).toFixed(1)}%`,
        trend: trend(Number(row.attendance_rate ?? 0), Number(row.prev_attendance_rate ?? 0)),
        color: "primary",
      },
      {
        title: "Productivity Score",
        value: `${Number(row.productivity_score ?? 0).toFixed(1)}%`,
        trend: trend(Number(row.productivity_score ?? 0), Number(row.prev_productivity_score ?? 0)),
        color: "purple",
      },
    ],
    charts: {
      dailyAttendance: dailyAttendanceResult.rows.map((item) => ({
        day: item.day,
        present: Number(item.present ?? 0),
        absent: Number(item.absent ?? 0),
      })),
      statusDistribution: statusDistributionResult.rows.map((item) => ({
        name: item.name,
        value: Number(item.value ?? 0),
      })),
      departmentAttendance: departmentAttendanceResult.rows.map((item) => ({
        name: item.name,
        value: Number(item.value ?? 0),
      })),
      attendanceSummary: statusDistributionResult.rows
        .filter((item) => ["Present", "Absent", "Late", "Half Day"].includes(item.name))
        .map((item) => ({
          name: item.name,
          value: Number(item.value ?? 0),
        })),
    },
    analytics: [
      {
        title: "Most Punctual Staff",
        value: analytics.most_punctual_staff ?? "-",
        description: "Highest on-time arrival rate",
        color: "success",
      },
      {
        title: "Avg Late Time",
        value: formatMinutes(Number(analytics.avg_late_time ?? 0)),
        description: "Average delay per late check-in",
        color: "warning",
      },
      {
        title: "Absence Risk Level",
        value: analytics.absence_risk_level ?? "Low",
        description: "Based on last 30 days pattern",
        color: "danger",
      },
      {
        title: "Attendance Growth",
        value: `${Number(analytics.attendance_growth ?? 0) >= 0 ? "+" : ""}${Number(analytics.attendance_growth ?? 0).toFixed(1)}%`,
        description: "Improvement vs last month",
        color: "primary",
      },
      {
        title: "Best Department",
        value: analytics.best_department ?? "-",
        description: "Highest attendance compliance",
        color: "purple",
      },
      {
        title: "Top Performer",
        value: analytics.top_performer ?? "-",
        description: "Best overall attendance score",
        color: "success",
      },
    ],
    table: tableResult.rows.map((item) => ({
      staffId: item.employee_code ?? "-",
      staff: item.staff_name ?? "-",
      department: item.department ?? "General",
      branch: item.branch_name ?? "Main Branch",
      date: new Date(item.attendance_date).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      checkIn: formatTime(item.check_in),
      checkOut: formatTime(item.check_out),
      workingHours: formatHours(item.hours_worked),
      lateBy: formatMinutes(Number(item.late_by_minutes ?? 0)),
      overtime: formatMinutes(Number(item.overtime_minutes ?? 0)),
      appointments: Number(item.completed_appointments ?? 0),
      attendance: formatAttendance(item.status),
    })),
  };
},

async getDayWiseCards(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
  }
) {
  const range = buildDayWiseContext(filters);
  const values = [salonId, range.from, range.to, range.prevFrom, range.prevTo];

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${DAY_WISE_BASE_CTES}
      SELECT
        COALESCE(SUM(net_amount), 0) AS total_revenue,
        COALESCE(SUM(collected_amount), 0) AS total_collections,
        COALESCE((SELECT COUNT(*) FROM current_appointments), 0) AS total_appointments,
        COUNT(DISTINCT client_id) AS customers_visited,
        COALESCE((SELECT SUM(net_amount) FROM previous_sales), 0) AS previous_revenue,
        COALESCE((SELECT SUM(collected_amount) FROM previous_sales), 0) AS previous_collections,
        COALESCE((SELECT COUNT(*) FROM previous_appointments), 0) AS previous_appointments,
        COALESCE((SELECT COUNT(DISTINCT client_id) FROM previous_sales), 0) AS previous_customers,
        COALESCE(COUNT(*), 0) AS invoice_count,
        COALESCE((SELECT COUNT(*) FROM previous_sales), 0) AS previous_invoice_count
      FROM current_sales
      `,
      values
    )
  );

  const row = rows[0] ?? {};

  const trend = (current: number, previous: number) => {
    if (previous <= 0) {
      return current > 0 ? "+100.0%" : "0.0%";
    }

    const value = ((current - previous) / previous) * 100;
    return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
  };

  const totalRevenue = Number(row.total_revenue ?? 0);
  const totalCollections = Number(row.total_collections ?? 0);
  const totalAppointments = Number(row.total_appointments ?? 0);
  const customersVisited = Number(row.customers_visited ?? 0);
  const invoiceCount = Number(row.invoice_count ?? 0);
  const avgRevenuePerCustomer =
    customersVisited > 0 ? totalRevenue / customersVisited : 0;
  const avgInvoiceValue =
    invoiceCount > 0 ? totalRevenue / invoiceCount : 0;
  const previousAvgRevenuePerCustomer =
    Number(row.previous_customers ?? 0) > 0
      ? Number(row.previous_revenue ?? 0) / Number(row.previous_customers ?? 1)
      : 0;
  const previousAvgInvoiceValue =
    Number(row.previous_invoice_count ?? 0) > 0
      ? Number(row.previous_revenue ?? 0) / Number(row.previous_invoice_count ?? 1)
      : 0;

  const formatCurrency = (value: number) =>
    `₹ ${Math.round(value).toLocaleString("en-IN")}`;

  return [
    {
      title: "Total Revenue",
      value: formatCurrency(totalRevenue),
      trend: trend(totalRevenue, Number(row.previous_revenue ?? 0)),
      color: "success",
      icon: "rupee-sign",
    },
    {
      title: "Total Collections",
      value: formatCurrency(totalCollections),
      trend: trend(totalCollections, Number(row.previous_collections ?? 0)),
      color: "primary",
      icon: "wallet",
    },
    {
      title: "Total Appointments",
      value: String(totalAppointments),
      trend: trend(totalAppointments, Number(row.previous_appointments ?? 0)),
      color: "warning",
      icon: "calendar-check",
    },
    {
      title: "Customers Visited",
      value: String(customersVisited),
      trend: trend(customersVisited, Number(row.previous_customers ?? 0)),
      color: "info",
      icon: "users",
    },
    {
      title: "Average Revenue Per Customer",
      value: formatCurrency(avgRevenuePerCustomer),
      trend: trend(avgRevenuePerCustomer, previousAvgRevenuePerCustomer),
      color: "purple",
      icon: "chart-line",
    },
    {
      title: "Average Invoice Value",
      value: formatCurrency(avgInvoiceValue),
      trend: trend(avgInvoiceValue, previousAvgInvoiceValue),
      color: "secondary",
      icon: "file-invoice",
    },
  ];
},

async getDayWiseRevenueTrend(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
  }
) {
  const range = buildDayWiseContext(filters);
  const values = [salonId, range.from, range.to, range.prevFrom, range.prevTo];

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${DAY_WISE_BASE_CTES}
      SELECT
        TO_CHAR(sale_day, 'Dy') AS day,
        COALESCE(SUM(net_amount), 0) AS revenue
      FROM current_sales
      GROUP BY sale_day
      ORDER BY sale_day
      `,
      values
    )
  );

  return rows.map((row) => ({
    day: row.day,
    revenue: Number(row.revenue ?? 0),
  }));
},

async getAppointmentTrend(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
  }
) {
  const range = buildDayWiseContext(filters);
  const values = [salonId, range.from, range.to, range.prevFrom, range.prevTo];

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${DAY_WISE_BASE_CTES}
      SELECT
        TO_CHAR(appointment_day, 'Dy') AS day,
        COUNT(*) AS appointments
      FROM current_appointments
      GROUP BY appointment_day
      ORDER BY appointment_day
      `,
      values
    )
  );

  return rows.map((row) => ({
    day: row.day,
    appointments: Number(row.appointments ?? 0),
  }));
},

async getStaffProductivity(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
  }
) {
  const range = buildDayWiseContext(filters);
  const values = [salonId, range.from, range.to, range.prevFrom, range.prevTo];

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${DAY_WISE_BASE_CTES}
      SELECT
        staff_name,
        COALESCE(revenue, 0) AS revenue,
        COALESCE(appointments, 0) AS appointments,
        COALESCE(services, 0) AS services
      FROM current_staff_productivity
      ORDER BY revenue DESC, staff_name ASC
      `,
      values
    )
  );

  return rows.map((row) => ({
    staffName: row.staff_name,
    revenue: Number(row.revenue ?? 0),
    appointments: Number(row.appointments ?? 0),
    services: Number(row.services ?? 0),
  }));
},

async getPaymentModeSummary(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
  }
) {
  const range = buildDayWiseContext(filters);
  const values = [salonId, range.from, range.to, range.prevFrom, range.prevTo];

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${DAY_WISE_BASE_CTES}
      SELECT
        payment_mode AS name,
        COALESCE(SUM(collected_amount), 0) AS value
      FROM current_sales
      GROUP BY payment_mode
      ORDER BY SUM(collected_amount) DESC, payment_mode ASC
      `,
      values
    )
  );

  return rows.map((row) => ({
    name: row.name,
    value: Number(row.value ?? 0),
  }));
},

async getDayWiseAnalytics(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
  }
) {
  const range = buildDayWiseContext(filters);
  const values = [salonId, range.from, range.to, range.prevFrom, range.prevTo];

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${DAY_WISE_BASE_CTES},
      best_revenue_day AS (
        SELECT
          TO_CHAR(sale_day, 'DD Mon YYYY') AS value
        FROM current_sales
        GROUP BY sale_day
        ORDER BY SUM(net_amount) DESC, sale_day DESC
        LIMIT 1
      ),
      best_staff AS (
        SELECT
          staff_name AS value
        FROM current_staff_productivity
        ORDER BY revenue DESC, staff_name ASC
        LIMIT 1
      ),
      payment_mode AS (
        SELECT
          payment_mode AS value
        FROM current_sales
        GROUP BY payment_mode
        ORDER BY SUM(collected_amount) DESC, payment_mode ASC
        LIMIT 1
      ),
      avg_collection AS (
        SELECT
          COALESCE(
            ROUND(
              SUM(collected_amount)
              /
              NULLIF(COUNT(DISTINCT sale_day), 0),
              2
            ),
            0
          ) AS value
        FROM current_sales
      ),
      peak_appointment_day AS (
        SELECT
          TO_CHAR(appointment_day, 'DD Mon YYYY') AS value
        FROM current_appointments
        GROUP BY appointment_day
        ORDER BY COUNT(*) DESC, appointment_day DESC
        LIMIT 1
      ),
      conversion AS (
        SELECT
          COALESCE(
            ROUND(
              (
                (SELECT COUNT(DISTINCT appointment_id) FROM current_sales WHERE appointment_id IS NOT NULL)::numeric
                /
                NULLIF((SELECT COUNT(*) FROM current_appointments), 0)
              ) * 100,
              2
            ),
            0
          ) AS value
      )
      SELECT
        COALESCE((SELECT value FROM best_revenue_day), '-') AS best_revenue_day,
        COALESCE((SELECT value FROM best_staff), '-') AS best_staff,
        COALESCE((SELECT value FROM payment_mode), 'Other') AS most_used_payment_mode,
        COALESCE((SELECT value FROM avg_collection), 0) AS average_daily_collection,
        COALESCE((SELECT value FROM peak_appointment_day), '-') AS peak_appointment_day,
        COALESCE((SELECT value FROM conversion), 0) AS customer_conversion_rate
      `,
      values
    )
  );

  const row = rows[0] ?? {};
  const formatCurrency = (value: number) =>
    `₹ ${Math.round(value).toLocaleString("en-IN")}`;

  return [
    {
      title: "Best Revenue Day",
      value: row.best_revenue_day ?? "-",
      subtitle: "Day with maximum sales",
      color: "success",
      icon: "calendar-days",
    },
    {
      title: "Best Performing Staff",
      value: row.best_staff ?? "-",
      subtitle: "Highest revenue generated",
      color: "primary",
      icon: "award",
    },
    {
      title: "Most Used Payment Mode",
      value: row.most_used_payment_mode ?? "Other",
      subtitle: "Highest collection source",
      color: "warning",
      icon: "credit-card",
    },
    {
      title: "Average Daily Collection",
      value: formatCurrency(Number(row.average_daily_collection ?? 0)),
      subtitle: "Based on selected period",
      color: "info",
      icon: "chart-line",
    },
    {
      title: "Peak Appointment Day",
      value: row.peak_appointment_day ?? "-",
      subtitle: "Most customer visits",
      color: "purple",
      icon: "users",
    },
    {
      title: "Customer Conversion Rate",
      value: `${Number(row.customer_conversion_rate ?? 0).toFixed(2)}%`,
      subtitle: "Appointments converted into completed sales",
      color: "danger",
      icon: "percent",
    },
  ];
},

async getDayWiseTable(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
    search?: string;
    page?: number;
    limit?: number;
    sort_by?: string;
    sort_order?: "asc" | "desc";
  }
) {
  const range = buildDayWiseContext(filters);
  const page = 1;

  const values: any[] = [salonId, range.from, range.to, range.prevFrom, range.prevTo];

  const searchClause = filters.search
    ? `
      WHERE
        COALESCE(invoice_no, '') ILIKE $6
        OR COALESCE(customer_name, '') ILIKE $6
        OR COALESCE(mobile, '') ILIKE $6
    `
    : "";

  if (filters.search) {
    values.push(`%${filters.search}%`);
  }

  const sortMap: Record<string, string> = {
    invoiceNo: "invoice_no",
    date: "created_at",
    customerName: "customer_name",
    mobile: "mobile",
    appointmentCount: "appointment_count",
    grossAmount: "gross_amount",
    discount: "discount_amount",
    tax: "tax_amount",
    netAmount: "net_amount",
    paymentMode: "payment_mode",
    collectedAmount: "collected_amount",
    pendingAmount: "pending_amount",
    staffName: "staff_name",
    status: "status",
  };

  const sortColumn = sortMap[filters.sort_by ?? "date"] ?? "created_at";
  const sortOrder = String(filters.sort_order ?? "desc").toLowerCase() === "asc"
    ? "ASC"
    : "DESC";

  const countResult = await safeQuery(() =>
    pool.query(
      `
      ${DAY_WISE_BASE_CTES},
      table_rows AS (
        SELECT
          invoice_no,
          created_at,
          customer_name,
          mobile,
          CASE WHEN appointment_id IS NOT NULL THEN 1 ELSE 0 END AS appointment_count,
          services,
          products,
          gross_amount,
          discount_amount,
          tax_amount,
          net_amount,
          payment_mode,
          collected_amount,
          pending_amount,
          staff_name,
          status,
          notes
        FROM current_sales
      )
      SELECT COUNT(*) AS total
      FROM table_rows
      ${searchClause}
      `,
      values
    )
  );

  const rowsResult = await safeQuery(() =>
    pool.query(
      `
      ${DAY_WISE_BASE_CTES},
      table_rows AS (
        SELECT
          invoice_no,
          created_at,
          customer_name,
          mobile,
          CASE WHEN appointment_id IS NOT NULL THEN 1 ELSE 0 END AS appointment_count,
          services,
          products,
          gross_amount,
          discount_amount,
          tax_amount,
          net_amount,
          payment_mode,
          collected_amount,
          pending_amount,
          staff_name,
          status,
          notes
        FROM current_sales
      )
      SELECT
        invoice_no,
        created_at,
        customer_name,
        mobile,
        appointment_count,
        services,
        products,
        gross_amount,
        discount_amount,
        tax_amount,
        net_amount,
        payment_mode,
        collected_amount,
        pending_amount,
        staff_name,
        status,
        notes
      FROM table_rows
      ${searchClause}
      ORDER BY ${sortColumn} ${sortOrder}, created_at DESC
      `,
      values
    )
  );

  const total = Number(countResult.rows[0]?.total ?? 0);
  const limit = rowsResult.rows.length;
  const totalPages = total > 0 ? 1 : 0;

  return {
    rows: rowsResult.rows.map((row) => ({
      invoiceNo: row.invoice_no,
      date: row.created_at,
      customerName: row.customer_name,
      mobile: row.mobile,
      appointmentCount: Number(row.appointment_count ?? 0),
      services: row.services ?? "",
      products: row.products ?? "",
      grossAmount: Number(row.gross_amount ?? 0),
      discount: Number(row.discount_amount ?? 0),
      tax: Number(row.tax_amount ?? 0),
      netAmount: Number(row.net_amount ?? 0),
      paymentMode: row.payment_mode,
      collectedAmount: Number(row.collected_amount ?? 0),
      pendingAmount: Number(row.pending_amount ?? 0),
      staffName: row.staff_name,
      status: row.status,
      notes: row.notes ?? "",
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
},

async getCouponRedemptionCards(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
  }
) {
  const { values, ctes } = buildCouponRedemptionBase(
    salonId,
    filters
  );

  const sql = `
    ${ctes}
    SELECT
      COALESCE(COUNT(*), 0) AS total_redemptions,
      COALESCE(SUM(discount_amount), 0) AS total_discount,
      COALESCE(COUNT(DISTINCT coupon_code), 0) AS unique_coupons,
      COALESCE(COUNT(DISTINCT client_id), 0) AS unique_customers,
      COALESCE(AVG(discount_amount), 0) AS average_discount
    FROM coupon_sales
  `;

  const { rows } = await safeQuery(() =>
    pool.query(sql, values)
  );

  const row = rows[0] ?? {};

  const formatCurrency = (value: number) =>
    `₹ ${Math.round(value).toLocaleString("en-IN")}`;

  return [
    {
      title: "Total Redemptions",
      value: String(Number(row.total_redemptions ?? 0)),
      trend: "0.0%",
      color: "primary",
    },
    {
      title: "Total Discount Given",
      value: formatCurrency(Number(row.total_discount ?? 0)),
      trend: "0.0%",
      color: "success",
    },
    {
      title: "Unique Coupons",
      value: String(Number(row.unique_coupons ?? 0)),
      trend: "0.0%",
      color: "warning",
    },
    {
      title: "Unique Customers",
      value: String(Number(row.unique_customers ?? 0)),
      trend: "0.0%",
      color: "info",
    },
    {
      title: "Avg Discount",
      value: formatCurrency(Number(row.average_discount ?? 0)),
      trend: "0.0%",
      color: "purple",
    },
  ];
},

async getCouponRedemptionCharts(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
  }
) {
  const { values, ctes } = buildCouponRedemptionBase(
    salonId,
    filters
  );

  const [
    trendResult,
    topCouponsResult,
    typeResult,
  ] = await Promise.all([
    safeQuery(() =>
      pool.query(
        `
        ${ctes}
        SELECT
          TO_CHAR(DATE_TRUNC('day', used_at AT TIME ZONE 'Asia/Kolkata'), 'Dy') AS day,
          COUNT(*) AS redemptions,
          COALESCE(SUM(discount_amount), 0) AS discount
        FROM coupon_sales
        GROUP BY DATE_TRUNC('day', used_at AT TIME ZONE 'Asia/Kolkata')
        ORDER BY DATE_TRUNC('day', used_at AT TIME ZONE 'Asia/Kolkata')
        `,
        values
      )
    ),
    safeQuery(() =>
      pool.query(
        `
        ${ctes}
        SELECT
          coupon_code AS day,
          COUNT(*) AS value,
          COALESCE(SUM(discount_amount), 0) AS amount
        FROM coupon_sales
        GROUP BY coupon_code
        ORDER BY value DESC, amount DESC, coupon_code ASC
        LIMIT 5
        `,
        values
      )
    ),
    safeQuery(() =>
      pool.query(
        `
        ${ctes}
        SELECT
          INITCAP(coupon_type) AS day,
          COUNT(*) AS value
        FROM coupon_sales
        GROUP BY coupon_type
        ORDER BY value DESC, day ASC
        `,
        values
      )
    ),
  ]);

  return {
    redemptionTrend: trendResult.rows.map((row) => ({
      day: row.day,
      redemptions: Number(row.redemptions ?? 0),
      discount: Number(row.discount ?? 0),
    })),
    topCoupons: topCouponsResult.rows.map((row) => ({
      day: row.day,
      value: Number(row.value ?? 0),
      amount: Number(row.amount ?? 0),
    })),
    couponTypeDistribution: typeResult.rows.map((row) => ({
      day: row.day,
      value: Number(row.value ?? 0),
    })),
  };
},

async getCouponRedemptionAnalytics(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
  }
) {
  const { values, ctes } = buildCouponRedemptionBase(
    salonId,
    filters
  );

  const sql = `
    ${ctes},
    top_coupon AS (
      SELECT coupon_code, COUNT(*) AS redemptions, SUM(discount_amount) AS discount
      FROM coupon_sales
      GROUP BY coupon_code
      ORDER BY redemptions DESC, discount DESC
      LIMIT 1
    ),
    top_customer AS (
      SELECT customer_name, COUNT(*) AS redemptions
      FROM coupon_sales
      GROUP BY customer_name
      ORDER BY redemptions DESC, customer_name ASC
      LIMIT 1
    ),
    best_day AS (
      SELECT TO_CHAR(DATE_TRUNC('day', used_at AT TIME ZONE 'Asia/Kolkata'), 'DD Mon YYYY') AS label, COUNT(*) AS redemptions
      FROM coupon_sales
      GROUP BY DATE_TRUNC('day', used_at AT TIME ZONE 'Asia/Kolkata')
      ORDER BY redemptions DESC
      LIMIT 1
    )
    SELECT
      COALESCE((SELECT coupon_code FROM top_coupon), '-') AS top_coupon,
      COALESCE((SELECT redemptions FROM top_coupon), 0) AS top_coupon_redemptions,
      COALESCE((SELECT customer_name FROM top_customer), '-') AS top_customer,
      COALESCE((SELECT redemptions FROM top_customer), 0) AS top_customer_redemptions,
      COALESCE((SELECT label FROM best_day), '-') AS best_day,
      COALESCE((SELECT redemptions FROM best_day), 0) AS best_day_redemptions,
      COALESCE(AVG(order_amount), 0) AS average_order_amount,
      COALESCE(SUM(net_amount), 0) AS net_revenue
    FROM coupon_sales
  `;

  const { rows } = await safeQuery(() =>
    pool.query(sql, values)
  );

  const row = rows[0] ?? {};
  const formatCurrency = (value: number) =>
    `₹ ${Math.round(value).toLocaleString("en-IN")}`;

  return [
    {
      title: "Top Coupon",
      value: row.top_coupon ?? "-",
      subtitle: `${Number(row.top_coupon_redemptions ?? 0)} redemptions`,
      color: "primary",
      icon: "ticket-percent",
    },
    {
      title: "Top Customer",
      value: row.top_customer ?? "-",
      subtitle: `${Number(row.top_customer_redemptions ?? 0)} coupon orders`,
      color: "success",
      icon: "users",
    },
    {
      title: "Best Redemption Day",
      value: row.best_day ?? "-",
      subtitle: `${Number(row.best_day_redemptions ?? 0)} redemptions`,
      color: "warning",
      icon: "calendar-days",
    },
    {
      title: "Avg Coupon Order",
      value: formatCurrency(Number(row.average_order_amount ?? 0)),
      subtitle: "Average order subtotal with coupon",
      color: "info",
      icon: "chart-line",
    },
    {
      title: "Net Revenue",
      value: formatCurrency(Number(row.net_revenue ?? 0)),
      subtitle: "Revenue after coupon usage",
      color: "purple",
      icon: "wallet",
    },
  ];
},

async getCouponRedemptionTable(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
  }
) {
  const { values, ctes } = buildCouponRedemptionBase(
    salonId,
    filters
  );

  const sql = `
    ${ctes}
    SELECT
      sale_id,
      invoice_no,
      coupon_code,
      coupon_type,
      coupon_value,
      customer_name,
      mobile,
      order_amount,
      discount_amount,
      net_amount,
      payment_method,
      staff_name,
      used_at,
      status
    FROM coupon_sales
    ORDER BY used_at DESC, invoice_no DESC
  `;

  const { rows } = await safeQuery(() =>
    pool.query(sql, values)
  );

  return {
    rows: rows.map((row) => ({
      saleId: row.sale_id,
      invoiceNo: row.invoice_no,
      couponCode: row.coupon_code,
      couponType: row.coupon_type,
      couponValue: Number(row.coupon_value ?? 0),
      customerName: row.customer_name,
      mobile: row.mobile,
      orderAmount: Number(row.order_amount ?? 0),
      discountAmount: Number(row.discount_amount ?? 0),
      netAmount: Number(row.net_amount ?? 0),
      paymentMethod: row.payment_method,
      staffName: row.staff_name,
      usedAt: row.used_at,
      status: row.status,
    })),
  };
},

async getBalanceReceivedReport(
  salonId: string,
  filters: {
    from?: string;
    to?: string;
    search?: string;
    page?: number;
    limit?: number;
    sort_by?: string;
    sort_order?: "asc" | "desc";
  }
) {
  const from = filters.from ?? new Date().toISOString().slice(0, 10);
  const to = filters.to ?? from;
  const page = 1;

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const diffDays = Math.max(
    1,
    Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );

  const prevToDate = new Date(fromDate);
  prevToDate.setUTCDate(prevToDate.getUTCDate() - 1);

  const prevFromDate = new Date(prevToDate);
  prevFromDate.setUTCDate(prevFromDate.getUTCDate() - diffDays + 1);

  const prevFrom = prevFromDate.toISOString().slice(0, 10);
  const prevTo = prevToDate.toISOString().slice(0, 10);

  const values: any[] = [salonId, from, to, prevFrom, prevTo];

  const searchClause = filters.search
    ? `
      WHERE
        COALESCE(receipt_no, '') ILIKE $6
        OR COALESCE(customer_name, '') ILIKE $6
        OR COALESCE(mobile, '') ILIKE $6
        OR COALESCE(invoice_no, '') ILIKE $6
        OR COALESCE(staff_name, '') ILIKE $6
        OR COALESCE(payment_method, '') ILIKE $6
        OR COALESCE(payment_status, '') ILIKE $6
        OR COALESCE(notes, '') ILIKE $6
    `
    : "";

  if (filters.search) {
    values.push(`%${filters.search}%`);
  }

  const sortMap: Record<string, string> = {
    receiptNo: "receipt_no",
    paymentDate: "payment_date",
    customerName: "customer_name",
    invoiceNo: "invoice_no",
    staffName: "staff_name",
    paymentMethod: "payment_method",
    amountReceived: "amount_received",
    previousBalance: "previous_balance",
    remainingBalance: "remaining_balance",
    paymentStatus: "payment_status",
  };

  const sortColumn = sortMap[filters.sort_by ?? "paymentDate"] ?? "payment_date";
  const sortOrder = String(filters.sort_order ?? "desc").toLowerCase() === "asc"
    ? "ASC"
    : "DESC";

  let trendLabelExpr = `TO_CHAR(DATE_TRUNC('day', payment_date AT TIME ZONE 'Asia/Kolkata'), 'Dy')`;
  let trendDateExpr = `TO_CHAR(DATE_TRUNC('day', payment_date AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')`;
  let trendGroupExpr = `DATE_TRUNC('day', payment_date AT TIME ZONE 'Asia/Kolkata')`;

  if (diffDays > 31 && diffDays <= 120) {
    trendLabelExpr = `CONCAT('Week ', TO_CHAR(DATE_TRUNC('week', payment_date AT TIME ZONE 'Asia/Kolkata'), 'DD Mon'))`;
    trendDateExpr = `TO_CHAR(DATE_TRUNC('week', payment_date AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')`;
    trendGroupExpr = `DATE_TRUNC('week', payment_date AT TIME ZONE 'Asia/Kolkata')`;
  } else if (diffDays > 120) {
    trendLabelExpr = `TO_CHAR(DATE_TRUNC('month', payment_date AT TIME ZONE 'Asia/Kolkata'), 'Mon YYYY')`;
    trendDateExpr = `TO_CHAR(DATE_TRUNC('month', payment_date AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD')`;
    trendGroupExpr = `DATE_TRUNC('month', payment_date AT TIME ZONE 'Asia/Kolkata')`;
  }

  const BALANCE_RECEIVED_BASE_CTES = `
    ${APPOINTMENT_BASE_CTES},
    appointment_staff AS (
      SELECT
        a.id AS appointment_id,
        COALESCE(
          NULLIF(TRIM(COALESCE(svc.value->>'staff_name', '')), ''),
          CONCAT_WS(' ', st.first_name, st.last_name),
          'Unknown'
        ) AS staff_name
      FROM appointments a
      LEFT JOIN LATERAL (
        SELECT svc.value
        FROM jsonb_array_elements(COALESCE(a.services, '[]'::jsonb)) AS svc(value)
        LIMIT 1
      ) svc
        ON TRUE
      LEFT JOIN staff st
        ON st.id::text = COALESCE(
          NULLIF(svc.value->>'staff_id', ''),
          a.staff_id::text
        )
    ),
    latest_payment_due AS (
      SELECT
        p.appointment_id,
        MAX(p.due_amount) FILTER (
          WHERE p.created_at = (
            SELECT MAX(p2.created_at)
            FROM payments p2
            WHERE p2.appointment_id = p.appointment_id
          )
        )::numeric AS latest_due
      FROM payments p
      WHERE p.appointment_id IS NOT NULL
      GROUP BY p.appointment_id
    ),
    payment_base AS (
      SELECT
        p.id,
        p.appointment_id,
        p.client_id,
        -- payment_date is left as a real timestamptz (paid_at is timestamptz;
        -- created_at is timestamp-without-tz but was written under this app's
        -- forced-UTC DB session — see config/database.ts — so Postgres's
        -- implicit timestamp->timestamptz promotion in this COALESCE
        -- correctly reconstructs the true instant). It's also returned raw
        -- to JS as paymentDate further down, so it must stay a proper
        -- timestamptz, not get converted to a naive IST value here — a
        -- "timestamp without time zone" would be parsed by node-postgres
        -- using the server process's local clock, not IST. payment_day only
        -- feeds date-bucketing/filtering (never returned raw), so it's safe
        -- to bucket by the IST calendar day directly.
        COALESCE(p.paid_at, p.created_at) AS payment_date,
        DATE(COALESCE(p.paid_at, p.created_at) AT TIME ZONE 'Asia/Kolkata') AS payment_day,
        COALESCE(p.paid_amount, p.net_amount, 0)::numeric AS amount_received,
        COALESCE(p.due_amount, 0)::numeric AS remaining_balance,
        (
          COALESCE(p.paid_amount, p.net_amount, 0)::numeric
          +
          COALESCE(p.due_amount, 0)::numeric
        ) AS previous_balance,
        COALESCE(p.notes, '') AS notes,
        LOWER(COALESCE(p.payment_method, 'cash')) AS payment_method_raw,
        LOWER(COALESCE(p.status, 'completed')) AS raw_payment_status,
        COALESCE(c.full_name, 'Walk-in Client') AS customer_name,
        COALESCE(c.phone_number, '') AS mobile,
        s.invoice_number AS invoice_no,
        COALESCE(ast.staff_name, 'Unknown') AS staff_name
      FROM payments p
      JOIN appointments a
        ON a.id = p.appointment_id
      LEFT JOIN sales s
        ON s.appointment_id = a.id
      LEFT JOIN clients c
        ON c.id = COALESCE(p.client_id, a.client_id)
      LEFT JOIN appointment_staff ast
        ON ast.appointment_id = a.id
      WHERE
        p.salon_id = $1
        AND p.appointment_id IS NOT NULL
        AND LOWER(COALESCE(a.status::text, '')) NOT IN ('cancelled', 'no-show')
        AND LOWER(COALESCE(p.status, '')) IN ('partial', 'completed')
        AND COALESCE(p.paid_amount, p.net_amount, 0) > 0
    ),
    normalized_payments AS (
      SELECT
        CONCAT('BR-', UPPER(LEFT(REPLACE(id::text, '-', ''), 8))) AS receipt_no,
        payment_date,
        payment_day,
        customer_name,
        mobile,
        invoice_no,
        staff_name,
        ${BALANCE_RECEIVED_PAYMENT_MODE_SQL} AS payment_method,
        ROUND(amount_received, 2) AS amount_received,
        ROUND(previous_balance, 2) AS previous_balance,
        ROUND(remaining_balance, 2) AS remaining_balance,
        CASE
          WHEN remaining_balance <= 0 THEN 'Paid'
          WHEN amount_received > 0 THEN 'Partial'
          ELSE 'Pending'
        END AS payment_status,
        notes,
        client_id,
        appointment_id
      FROM payment_base
    ),
    appointment_outstanding AS (
      SELECT
        m.id AS appointment_id,
        m.client_id,
        DATE(m.scheduled_at) AS scheduled_day,
        COALESCE(ast.staff_name, 'Unknown') AS staff_name,
        CASE
          WHEN LOWER(COALESCE(m.payment_state, '')) = 'paid' THEN 0::numeric
          WHEN lp.appointment_id IS NOT NULL THEN GREATEST(COALESCE(lp.latest_due, 0), 0)::numeric
          ELSE GREATEST(COALESCE(m.appointment_amount, 0), 0)::numeric
        END AS outstanding_balance,
        CASE
          WHEN LOWER(COALESCE(m.payment_state, '')) = 'paid' THEN 'Paid'
          WHEN LOWER(COALESCE(m.payment_state, '')) = 'partial' THEN 'Partial'
          ELSE 'Pending'
        END AS payment_status
      FROM metrics m
      LEFT JOIN latest_payment_due lp
        ON lp.appointment_id = m.id
      LEFT JOIN appointment_staff ast
        ON ast.appointment_id = m.id
      WHERE
        m.salon_id = $1
        AND LOWER(COALESCE(m.status::text, '')) NOT IN ('cancelled', 'no-show')
    ),
    current_period AS (
      SELECT *
      FROM normalized_payments
      WHERE payment_day >= $2 AND payment_day <= $3
    ),
    previous_period AS (
      SELECT *
      FROM normalized_payments
      WHERE payment_day >= $4 AND payment_day <= $5
    ),
    current_outstanding AS (
      SELECT *
      FROM appointment_outstanding
      WHERE scheduled_day >= $2 AND scheduled_day <= $3
    ),
    previous_outstanding AS (
      SELECT *
      FROM appointment_outstanding
      WHERE scheduled_day >= $4 AND scheduled_day <= $5
    ),
    current_customer_outstanding AS (
      SELECT
        client_id,
        COALESCE(SUM(outstanding_balance), 0) AS total_outstanding
      FROM current_outstanding
      GROUP BY client_id
    ),
    previous_customer_outstanding AS (
      SELECT
        client_id,
        COALESCE(SUM(outstanding_balance), 0) AS total_outstanding
      FROM previous_outstanding
      GROUP BY client_id
    )
  `;

  const summaryPromise = safeQuery(() =>
    pool.query(
      `
      ${BALANCE_RECEIVED_BASE_CTES}
      SELECT
        COALESCE(SUM(amount_received), 0) AS total_received,
        COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN amount_received ELSE 0 END), 0) AS cash_received,
        COALESCE(SUM(CASE WHEN payment_method IN ('Card', 'UPI', 'Bank', 'Wallet') THEN amount_received ELSE 0 END), 0) AS digital_received,
        COUNT(DISTINCT client_id) AS customers_paid,
        COALESCE((SELECT SUM(outstanding_balance) FROM current_outstanding), 0) AS pending_balance,
        COALESCE((SELECT SUM(outstanding_balance) FROM previous_outstanding), 0) AS previous_pending_balance,
        COALESCE((SELECT SUM(amount_received) FROM previous_period), 0) AS previous_total_received,
        COALESCE((SELECT SUM(CASE WHEN payment_method = 'Cash' THEN amount_received ELSE 0 END) FROM previous_period), 0) AS previous_cash_received,
        COALESCE((SELECT SUM(CASE WHEN payment_method IN ('Card', 'UPI', 'Bank', 'Wallet') THEN amount_received ELSE 0 END) FROM previous_period), 0) AS previous_digital_received,
        COALESCE((SELECT COUNT(DISTINCT client_id) FROM previous_period), 0) AS previous_customers_paid,
        COALESCE(
          ROUND(
            (
              COALESCE(SUM(amount_received), 0)
              /
              NULLIF(
                COALESCE(SUM(amount_received), 0)
                + COALESCE((SELECT SUM(outstanding_balance) FROM current_outstanding), 0),
                0
              )
            ) * 100,
            2
          ),
          0
        ) AS collection_rate
      FROM current_period
      `,
      values
    )
  );

  const dailyCollectionPromise = safeQuery(() =>
    pool.query(
      `
      ${BALANCE_RECEIVED_BASE_CTES}
      SELECT
        ${trendLabelExpr} AS day,
        ${trendDateExpr} AS date,
        COALESCE(SUM(amount_received), 0) AS amount
      FROM current_period
      GROUP BY ${trendGroupExpr}
      ORDER BY ${trendGroupExpr}
      `,
      values
    )
  );

  const paymentModePromise = safeQuery(() =>
    pool.query(
      `
      ${BALANCE_RECEIVED_BASE_CTES}
      SELECT
        payment_method AS name,
        COALESCE(SUM(amount_received), 0) AS value
      FROM current_period
      GROUP BY payment_method
      ORDER BY SUM(amount_received) DESC, payment_method ASC
      `,
      values
    )
  );

  const staffPerformancePromise = safeQuery(() =>
    pool.query(
      `
      ${BALANCE_RECEIVED_BASE_CTES}
      SELECT
        COALESCE(staff_name, 'Unknown') AS name,
        COALESCE(SUM(amount_received), 0) AS value
      FROM current_period
      GROUP BY COALESCE(staff_name, 'Unknown')
      ORDER BY value DESC, name ASC
      `,
      values
    )
  );

  const paymentStatusPromise = safeQuery(() =>
    pool.query(
      `
      ${BALANCE_RECEIVED_BASE_CTES}
      SELECT * FROM (
        SELECT 'Paid' AS name, COUNT(*) FILTER (WHERE payment_status = 'Paid') AS value FROM current_outstanding
        UNION ALL
        SELECT 'Partial' AS name, COUNT(*) FILTER (WHERE payment_status = 'Partial') AS value FROM current_outstanding
        UNION ALL
        SELECT 'Pending' AS name, COUNT(*) FILTER (WHERE payment_status = 'Pending') AS value FROM current_outstanding
      ) status_rows
      `,
      values
    )
  );

  const analyticsPromise = safeQuery(() =>
    pool.query(
      `
      ${BALANCE_RECEIVED_BASE_CTES},
      highest_collection_day AS (
        SELECT
          TO_CHAR(payment_day, 'DD Mon YYYY') AS value
        FROM current_period
        GROUP BY payment_day
        ORDER BY SUM(amount_received) DESC, payment_day DESC
        LIMIT 1
      ),
      avg_collection AS (
        SELECT
          COALESCE(
            ROUND(
              SUM(amount_received) / NULLIF(COUNT(DISTINCT payment_day), 0),
              2
            ),
            0
          ) AS value
        FROM current_period
      ),
      cleared_customers AS (
        SELECT
          COUNT(*) FILTER (WHERE total_outstanding <= 0) AS value
        FROM current_customer_outstanding
      ),
      efficiency AS (
        SELECT
          COALESCE(
            ROUND(
              (
                COALESCE((SELECT SUM(amount_received) FROM current_period), 0)
                /
                NULLIF(
                  COALESCE((SELECT SUM(amount_received) FROM current_period), 0)
                  + COALESCE((SELECT SUM(outstanding_balance) FROM current_outstanding), 0),
                  0
                )
              ) * 100,
              2
            ),
            0
          ) AS value
      ),
      digital_share AS (
        SELECT
          COALESCE(
            ROUND(
              (
                COALESCE(SUM(CASE WHEN payment_method IN ('Card', 'UPI', 'Bank', 'Wallet') THEN amount_received ELSE 0 END), 0)
                /
                NULLIF(SUM(amount_received), 0)
              ) * 100,
              2
            ),
            0
          ) AS value
        FROM current_period
      )
      SELECT
        COALESCE((SELECT value FROM avg_collection), 0) AS avg_collection_per_day,
        COALESCE((SELECT value FROM cleared_customers), 0) AS customers_cleared,
        COALESCE((SELECT value FROM highest_collection_day), '-') AS highest_collection_day,
        COALESCE((SELECT value FROM efficiency), 0) AS collection_efficiency,
        COALESCE((SELECT SUM(outstanding_balance) FROM current_outstanding), 0) AS pending_balance,
        COALESCE((SELECT value FROM digital_share), 0) AS digital_payment_percentage
      `,
      values
    )
  );

  const tableCountPromise = safeQuery(() =>
    pool.query(
      `
      ${BALANCE_RECEIVED_BASE_CTES},
      table_rows AS (
        SELECT
          receipt_no,
          payment_date,
          customer_name,
          mobile,
          invoice_no,
          staff_name,
          payment_method,
          amount_received,
          previous_balance,
          remaining_balance,
          payment_status,
          notes
        FROM current_period
      )
      SELECT COUNT(*) AS total
      FROM table_rows
      ${searchClause}
      `,
      values
    )
  );

  const tableRowsPromise = safeQuery(() =>
    pool.query(
      `
      ${BALANCE_RECEIVED_BASE_CTES},
      table_rows AS (
        SELECT
          receipt_no,
          payment_date,
          customer_name,
          mobile,
          invoice_no,
          staff_name,
          payment_method,
          amount_received,
          previous_balance,
          remaining_balance,
          payment_status,
          notes
        FROM current_period
      )
      SELECT
        receipt_no,
        payment_date,
        customer_name,
        mobile,
        invoice_no,
        staff_name,
        payment_method,
        amount_received,
        previous_balance,
        remaining_balance,
        payment_status,
        notes
      FROM table_rows
      ${searchClause}
      ORDER BY ${sortColumn} ${sortOrder}, payment_date DESC
      `,
      values
    )
  );

  const [
    summaryResult,
    dailyCollectionResult,
    paymentModeResult,
    staffPerformanceResult,
    paymentStatusResult,
    analyticsResult,
    tableCountResult,
    tableRowsResult,
  ] = await Promise.all([
    summaryPromise,
    dailyCollectionPromise,
    paymentModePromise,
    staffPerformancePromise,
    paymentStatusPromise,
    analyticsPromise,
    tableCountPromise,
    tableRowsPromise,
  ]);

  const summary = summaryResult.rows[0] ?? {};
  const analytics = analyticsResult.rows[0] ?? {};
  const totalTableRows = Number(tableCountResult.rows[0]?.total ?? 0);
  const limit = tableRowsResult.rows.length;
  const totalPages = totalTableRows > 0 ? 1 : 0;

  const formatCurrency = (value: number) =>
    `₹ ${Math.round(value).toLocaleString("en-IN")}`;

  const formatPercent = (value: number) =>
    `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

  const buildTrend = (current: number, previous: number) => {
    if (previous <= 0) {
      return current > 0 ? "+100.0%" : "0.0%";
    }

    return formatPercent(
      ((current - previous) / previous) * 100
    );
  };

  const totalReceived = Number(summary.total_received ?? 0);
  const cashReceived = Number(summary.cash_received ?? 0);
  const digitalReceived = Number(summary.digital_received ?? 0);
  const customersPaid = Number(summary.customers_paid ?? 0);
  const pendingBalance = Number(summary.pending_balance ?? 0);
  const previousPendingBalance = Number(summary.previous_pending_balance ?? 0);
  const collectionRate = Number(summary.collection_rate ?? 0);

  return {
    cards: [
      {
        title: "Total Balance Received",
        value: formatCurrency(totalReceived),
        trend: buildTrend(totalReceived, Number(summary.previous_total_received ?? 0)),
      },
      {
        title: "Cash Received",
        value: formatCurrency(cashReceived),
        trend: buildTrend(cashReceived, Number(summary.previous_cash_received ?? 0)),
      },
      {
        title: "Card / UPI Received",
        value: formatCurrency(digitalReceived),
        trend: buildTrend(digitalReceived, Number(summary.previous_digital_received ?? 0)),
      },
      {
        title: "Customers Paid",
        value: String(customersPaid),
        trend: buildTrend(customersPaid, Number(summary.previous_customers_paid ?? 0)),
      },
      {
        title: "Pending Balance",
        value: formatCurrency(pendingBalance),
        trend: buildTrend(pendingBalance, previousPendingBalance),
      },
      {
        title: "Collection Rate",
        value: `${collectionRate.toFixed(2)}%`,
        trend: "0.0%",
      },
    ],
    charts: {
      dailyBalanceCollection: dailyCollectionResult.rows.map((row) => ({
        day: row.day,
        date: row.date,
        amount: Number(row.amount ?? 0),
      })),
      paymentModeDistribution: paymentModeResult.rows.map((row) => ({
        name: row.name,
        value: Number(row.value ?? 0),
      })),
      staffCollectionPerformance: staffPerformanceResult.rows.map((row) => ({
        name: row.name,
        value: Number(row.value ?? 0),
      })),
      paymentStatus: paymentStatusResult.rows.map((row) => ({
        name: row.name,
        value: Number(row.value ?? 0),
      })),
    },
    analytics: [
      {
        title: "Average Collection Per Day",
        value: formatCurrency(Number(analytics.avg_collection_per_day ?? 0)),
        subtitle: "Average balance received each day",
        color: "primary",
        icon: "calendar-days",
      },
      {
        title: "Customers Cleared",
        value: String(Number(analytics.customers_cleared ?? 0)),
        subtitle: "Customers with zero outstanding balance",
        color: "success",
        icon: "user-check",
      },
      {
        title: "Highest Collection Day",
        value: analytics.highest_collection_day ?? "-",
        subtitle: "Best performing collection date",
        color: "warning",
        icon: "trophy",
      },
      {
        title: "Collection Efficiency %",
        value: `${Number(analytics.collection_efficiency ?? 0).toFixed(2)}%`,
        subtitle: "Received balance against total collectible balance",
        color: "info",
        icon: "gauge",
      },
      {
        title: "Pending Balance",
        value: formatCurrency(Number(analytics.pending_balance ?? 0)),
        subtitle: "Outstanding customer dues",
        color: "danger",
        icon: "wallet",
      },
      {
        title: "Digital Payment %",
        value: `${Number(analytics.digital_payment_percentage ?? 0).toFixed(2)}%`,
        subtitle: "Share of card, UPI, bank and wallet payments",
        color: "purple",
        icon: "smartphone",
      },
    ],
    table: {
      rows: tableRowsResult.rows.map((row) => ({
        receiptNo: row.receipt_no,
        paymentDate: row.payment_date,
        customerName: row.customer_name,
        mobile: row.mobile,
        invoiceNo: row.invoice_no,
        staffName: row.staff_name,
        paymentMethod: row.payment_method,
        amountReceived: Number(row.amount_received ?? 0),
        previousBalance: Number(row.previous_balance ?? 0),
        remainingBalance: Number(row.remaining_balance ?? 0),
        paymentStatus: row.payment_status,
        notes: row.notes ?? "",
      })),
      pagination: {
        page,
        limit,
        total: totalTableRows,
        totalPages,
      },
    },
  };
},

// ======================================================
// CLIENT RATING REPORT (independent report API)
// POST /api/report/client-rating — reads the reviews table directly
// (JOIN clients/staff for display names), one row per review. Only
// is_visible = true reviews are included, matching what the reviews module
// treats as client-facing/visible. Never calls into the reviews module's
// service/repository, and never touches the Appointment API/service.
// ======================================================

_buildClientRatingWhere(
  salonId: string,
  filters: { search?: string; staff_ids?: string[]; min_rating?: number; start_date?: string; end_date?: string }
): { where: string; values: any[]; nextIndex: number } {
  const values: any[] = [salonId];
  const where = ["r.salon_id = $1", "r.is_visible = true"];
  let idx = 2;

  if (filters.staff_ids && filters.staff_ids.length > 0) {
    where.push(`r.staff_id = ANY($${idx++}::uuid[])`);
    values.push(filters.staff_ids);
  }
  if (filters.min_rating !== undefined) {
    where.push(`r.rating >= $${idx++}`);
    values.push(filters.min_rating);
  }
  if (filters.start_date) {
    where.push(`r.created_at >= $${idx++}::date`);
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    where.push(`r.created_at < ($${idx++}::date + interval '1 day')`);
    values.push(filters.end_date);
  }
  if (filters.search?.trim()) {
    where.push(`(
      COALESCE(c.full_name, '') ILIKE $${idx}
      OR COALESCE(c.phone_number, '') ILIKE $${idx}
      OR COALESCE(TRIM(CONCAT(st.first_name, ' ', st.last_name)), '') ILIKE $${idx}
    )`);
    values.push(`%${filters.search.trim()}%`);
    idx++;
  }

  return { where: where.join(" AND "), values, nextIndex: idx };
},

_CLIENT_RATING_JOIN: `
    FROM reviews r
    LEFT JOIN clients c ON c.id = r.client_id
    LEFT JOIN staff st ON st.id = r.staff_id
`,

async getClientRatingReportStats(
  salonId: string,
  filters: { start_date?: string; end_date?: string; search?: string; staff_ids?: string[]; min_rating?: number }
): Promise<ClientRatingReportStats> {
  const { where, values } = this._buildClientRatingWhere(salonId, filters);

  const query = `
    SELECT
      COUNT(*)::int AS total_reviews,
      COALESCE(AVG(r.rating), 0)::numeric(3,2) AS average_rating,
      COUNT(*) FILTER (WHERE r.rating >= 4)::int AS positive_reviews,
      COUNT(*) FILTER (WHERE r.rating <= 2)::int AS negative_reviews
    ${this._CLIENT_RATING_JOIN}
    WHERE ${where}
  `;

  const { rows } = await safeQuery(() => pool.query(query, values));
  const r = rows[0] ?? {};
  return {
    total_reviews: Number(r.total_reviews ?? 0),
    average_rating: Number(r.average_rating ?? 0),
    positive_reviews: Number(r.positive_reviews ?? 0),
    negative_reviews: Number(r.negative_reviews ?? 0),
  };
},

async getClientRatingReportRows(
  salonId: string,
  filters: {
    start_date?: string; end_date?: string; search?: string;
    staff_ids?: string[]; min_rating?: number;
    page?: number; limit?: number; is_export?: boolean;
  }
): Promise<{
  items: ClientRatingReportRow[];
  pagination: { total: number; page: number; limit: number; total_pages: number };
}> {
  const { where, values, nextIndex } = this._buildClientRatingWhere(salonId, filters);
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
      COALESCE(NULLIF(TRIM(c.full_name), ''), 'Walk-in') AS client_name,
      COALESCE(NULLIF(TRIM(CONCAT(COALESCE(c.phone_country_code, ''), ' ', COALESCE(c.phone_number, ''))), ''), '—') AS contact,
      st.id AS staff_id,
      NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), '') AS staff_name,
      r.rating,
      r.staff_rating,
      r.service_rating,
      r.ambience_rating,
      r.review_text,
      r.created_at AS review_date,
      r.source,
      COALESCE((
        SELECT SUM(s.total_amount::numeric)
        FROM sales s
        WHERE s.client_id = c.id AND s.status = 'completed' AND s.salon_id = r.salon_id
      ), 0) AS total_spend,
      COALESCE((
        SELECT COUNT(s.id)
        FROM sales s
        WHERE s.client_id = c.id AND s.status = 'completed' AND s.salon_id = r.salon_id
      ), 0) AS visits,
      COUNT(*) OVER() AS total_count
    ${this._CLIENT_RATING_JOIN}
    WHERE ${where}
    ORDER BY r.created_at DESC
    ${limitClause}
  `;

  const { rows } = await safeQuery(() => pool.query(query, [...values, ...limitValues]));
  const total = rows.length ? Number(rows[0].total_count) : 0;
  const items: ClientRatingReportRow[] = rows.map((row: any) => ({
    client_id: row.client_id,
    client_name: row.client_name,
    contact: row.contact,
    staff_id: row.staff_id,
    staff_name: row.staff_name ?? "—",
    rating: Number(row.rating ?? 0),
    staff_rating: row.staff_rating !== null && row.staff_rating !== undefined ? Number(row.staff_rating) : null,
    service_rating: row.service_rating !== null && row.service_rating !== undefined ? Number(row.service_rating) : null,
    ambience_rating: row.ambience_rating !== null && row.ambience_rating !== undefined ? Number(row.ambience_rating) : null,
    review_text: row.review_text,
    review_date: row.review_date,
    source: row.source,
    total_spend: Math.round(Number(row.total_spend ?? 0)),
    visits: Number(row.visits ?? 0),
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
