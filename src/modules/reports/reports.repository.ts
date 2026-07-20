import pool, { safeQuery } from "../../config/database";
import {
    CategoryTotalsRow,
    FootfallRow,
    InvoiceAdjustmentsRow,
    SalesSummaryTableData,
    SalesSummaryTableItemDetail,
    TopItemRow,
    TopStylistRow,
} from "./reports.types";


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
      COALESCE(l.read_at, l.delivered_at, l.sent_at, l.created_at) AS message_at,
      DATE(COALESCE(l.sent_at, l.created_at)) AS reminder_date,
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
      DATE(s.created_at) AS sale_day,
      COALESCE(s.invoice_number, s.id::text) AS invoice_no,
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
      DATE(a.created_at) AS appointment_day
    FROM appointments a
    WHERE
      a.salon_id = $1
      AND DATE(a.created_at) >= $4
      AND DATE(a.created_at) <= $3
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
      DATE(s.created_at) AS sale_day,
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
      DATE(s.created_at),
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
        COALESCE(NULLIF(s.invoice_number, ''), CONCAT('INV-', s.id::text)) AS invoice_no,
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

const buildStaffCommissionSourceQuery = (
  salonId: string,
  filters: { from?: string; to?: string }
) => {
  const values: any[] = [salonId];
  const saleWhere = [
    "s.salon_id = $1",
    "s.status IN ('draft', 'completed', 'refunded')",
    "COALESCE(ni.item_staff_id, s.staff_id) IS NOT NULL",
    "ni.item_type IN ('service', 'package', 'product', 'membership', 'gift_card')",
  ];
  const appointmentWhere = [
    "m.salon_id = $1",
    "NOT EXISTS (SELECT 1 FROM sales sx WHERE sx.appointment_id = m.id)",
  ];

  let index = 2;

  if (filters.from) {
    saleWhere.push(`DATE(s.created_at) >= $${index}`);
    appointmentWhere.push(`DATE(m.created_at) >= $${index}`);
    values.push(filters.from);
    index++;
  }

  if (filters.to) {
    saleWhere.push(`DATE(s.created_at) <= $${index}`);
    appointmentWhere.push(`DATE(m.created_at) <= $${index}`);
    values.push(filters.to);
    index++;
  }

  const salesSummaryCtes = SALES_SUMMARY_ITEM_CTES.replace(/^\s*WITH\s+/, "");
  const appointmentBaseCtes = APPOINTMENT_BASE_CTES.replace(/^\s*WITH\s+/, "");

  const saleCommissionCategoryExpr = `
    CASE
      WHEN ni.item_type IN ('service', 'package') THEN 'services'
      WHEN ni.item_type = 'product' THEN 'products'
      WHEN ni.item_type = 'membership' THEN 'memberships'
      WHEN ni.item_type = 'gift_card' THEN 'gift_cards'
      ELSE 'services'
    END
  `;

  const appointmentCommissionCategoryExpr = `
    CASE
      WHEN ali.item_type IN ('service', 'package') THEN 'services'
      WHEN ali.item_type = 'product' THEN 'products'
      WHEN ali.item_type = 'membership' THEN 'memberships'
      WHEN ali.item_type = 'gift_card' THEN 'gift_cards'
      ELSE 'services'
    END
  `;

  return {
    values,
    ctes: `
      WITH ${salesSummaryCtes},
      ${appointmentBaseCtes},
      sale_category_totals AS (
        SELECT
          s.id AS sale_id,
          COALESCE(ni.item_staff_id, s.staff_id) AS staff_id,
          ${saleCommissionCategoryExpr} AS commission_category,
          SUM(COALESCE(ni.total_price::numeric, 0)) AS category_revenue
        FROM normalized_items ni
        JOIN sales s
          ON s.id = ni.sale_id
        WHERE ${saleWhere.join(" AND ")}
        GROUP BY
          s.id,
          COALESCE(ni.item_staff_id, s.staff_id),
          ${saleCommissionCategoryExpr}
      ),
      sale_line_rows AS (
        SELECT
          s.created_at AS date,
          COALESCE(s.invoice_number, CONCAT('INV-', s.id::text)) AS invoice_no,
          COALESCE(c.full_name, 'Walk-in Client') AS customer_name,
          COALESCE(c.phone_number, '') AS mobile,
          COALESCE(
            NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''),
            'Unknown'
          ) AS staff_name,
          ni.item_type,
          COALESCE(ni.name, 'Item') AS item_name,
          COALESCE(ni.quantity, 1) AS quantity,
          ROUND(COALESCE(ni.total_price::numeric, 0), 2) AS revenue_amount,
          ROUND(
            COALESCE(
              ce.commission_rate,
              slab.commission_value,
              scs.default_rate,
              0
            ),
            2
          ) AS commission_rate,
          COALESCE(
            ce.commission_kind,
            slab.commission_kind,
            scs.commission_kind,
            '-'
          ) AS commission_kind,
          ROUND(
            CASE
              WHEN COALESCE(sct.category_revenue, 0) > 0
                   AND COALESCE(ce.commission_amount, 0) > 0
              THEN
                COALESCE(ce.commission_amount, 0)
                *
                (COALESCE(ni.total_price::numeric, 0) / sct.category_revenue)
              WHEN slab.commission_kind = 'percentage'
              THEN COALESCE(ni.total_price::numeric, 0) * COALESCE(slab.commission_value, 0) / 100
              WHEN slab.commission_kind = 'fixed_rate'
              THEN
                CASE
                  WHEN COALESCE(slab.revenue_target, 0) > 0
                  THEN FLOOR(COALESCE(ni.total_price::numeric, 0) / slab.revenue_target) * COALESCE(slab.commission_value, 0)
                  ELSE COALESCE(slab.commission_value, 0)
                END
              WHEN scs.commission_kind = 'percentage'
              THEN COALESCE(ni.total_price::numeric, 0) * COALESCE(scs.default_rate, 0) / 100
              WHEN scs.commission_kind = 'fixed_rate'
              THEN
                CASE
                  WHEN COALESCE(scs.revenue_target, 0) > 0
                  THEN FLOOR(COALESCE(ni.total_price::numeric, 0) / scs.revenue_target) * COALESCE(scs.default_rate, 0)
                  ELSE COALESCE(scs.default_rate, 0)
                END
              ELSE 0
            END,
            2
          ) AS commission_amount,
          CASE
            WHEN ce.payout_status IS NOT NULL
            THEN INITCAP(ce.payout_status)
            WHEN LOWER(COALESCE(m.payment_state, s.status::text, '')) = 'refunded'
            THEN 'Cancelled'
            ELSE 'Pending'
          END AS payout_status,
          CASE
            WHEN m.id IS NOT NULL THEN INITCAP(COALESCE(m.payment_state, 'unpaid'))
            WHEN LOWER(COALESCE(s.status::text, '')) = 'completed' THEN 'Paid'
            WHEN LOWER(COALESCE(s.status::text, '')) = 'draft' THEN 'Pending'
            WHEN LOWER(COALESCE(s.status::text, '')) = 'refunded' THEN 'Refunded'
            ELSE INITCAP(COALESCE(s.status::text, 'pending'))
          END AS payment_status,
          'Sale'::text AS source
        FROM normalized_items ni
        JOIN sales s
          ON s.id = ni.sale_id
        LEFT JOIN clients c
          ON c.id = s.client_id
        LEFT JOIN staff st
          ON st.id = COALESCE(ni.item_staff_id, s.staff_id)
        LEFT JOIN metrics m
          ON m.id = s.appointment_id
        LEFT JOIN sale_category_totals sct
          ON sct.sale_id = s.id
          AND sct.staff_id = COALESCE(ni.item_staff_id, s.staff_id)
          AND sct.commission_category = ${saleCommissionCategoryExpr}
        LEFT JOIN LATERAL (
          SELECT
            SUM(ce2.commission_amount::numeric) AS commission_amount,
            MAX(ce2.commission_rate::numeric) AS commission_rate,
            MAX(ce2.commission_kind) AS commission_kind,
            MAX(ce2.status::text) AS payout_status
          FROM commission_earned ce2
          WHERE
            ce2.salon_id = $1
            AND ce2.sale_id = s.id
            AND ce2.staff_id = COALESCE(ni.item_staff_id, s.staff_id)
            AND ce2.category = ${saleCommissionCategoryExpr}
        ) ce
          ON TRUE
        LEFT JOIN staff_commission_settings scs
          ON scs.staff_id = COALESCE(ni.item_staff_id, s.staff_id)
          AND scs.category = ${saleCommissionCategoryExpr}
          AND scs.is_enabled = TRUE
        LEFT JOIN LATERAL (
          SELECT
            cs.commission_kind,
            cs.commission_value,
            cs.revenue_target
          FROM commission_slabs cs
          WHERE
            cs.staff_id = COALESCE(ni.item_staff_id, s.staff_id)
            AND cs.category = ${saleCommissionCategoryExpr}
            AND cs.is_enabled = TRUE
            AND cs.revenue_target <= COALESCE(ni.total_price::numeric, 0)
          ORDER BY
            cs.revenue_target DESC,
            cs.created_at DESC
          LIMIT 1
        ) slab
          ON TRUE
        WHERE ${saleWhere.join(" AND ")}
      ),
      appointment_line_items AS (
        SELECT
          m.id AS appointment_id,
          m.created_at,
          COALESCE(c.full_name, 'Walk-in Client') AS customer_name,
          COALESCE(c.phone_number, '') AS mobile,
          'service'::text AS item_type,
          COALESCE(NULLIF(svc.value->>'name', ''), 'Service') AS item_name,
          COALESCE(NULLIF(svc.value->>'qty', '')::int, NULLIF(svc.value->>'quantity', '')::int, 1) AS quantity,
          COALESCE(NULLIF(svc.value->>'total', '')::numeric, COALESCE(NULLIF(svc.value->>'price', '')::numeric, 0) * COALESCE(NULLIF(svc.value->>'qty', '')::numeric, NULLIF(svc.value->>'quantity', '')::numeric, 1)) AS revenue_amount,
          NULLIF(svc.value->>'staff_id', '') AS item_staff_id,
          NULLIF(svc.value->>'staff_name', '') AS item_staff_name,
          m.payment_state,
          m.status
        FROM metrics m
        LEFT JOIN clients c
          ON c.id = m.client_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.services, '[]'::jsonb)) AS svc(value)
        WHERE ${appointmentWhere.join(" AND ")}

        UNION ALL

        SELECT
          m.id AS appointment_id,
          m.created_at,
          COALESCE(c.full_name, 'Walk-in Client') AS customer_name,
          COALESCE(c.phone_number, '') AS mobile,
          'package'::text AS item_type,
          COALESCE(NULLIF(pkg.value->>'name', ''), 'Package') AS item_name,
          COALESCE(NULLIF(pkg.value->>'qty', '')::int, NULLIF(pkg.value->>'quantity', '')::int, 1) AS quantity,
          COALESCE(NULLIF(pkg.value->>'price', '')::numeric, 0) * COALESCE(NULLIF(pkg.value->>'qty', '')::numeric, NULLIF(pkg.value->>'quantity', '')::numeric, 1) AS revenue_amount,
          NULLIF(pkg.value->>'staff_id', '') AS item_staff_id,
          NULLIF(pkg.value->>'staff_name', '') AS item_staff_name,
          m.payment_state,
          m.status
        FROM metrics m
        LEFT JOIN clients c
          ON c.id = m.client_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.package_items, '[]'::jsonb)) AS pkg(value)
        WHERE ${appointmentWhere.join(" AND ")}

        UNION ALL

        SELECT
          m.id AS appointment_id,
          m.created_at,
          COALESCE(c.full_name, 'Walk-in Client') AS customer_name,
          COALESCE(c.phone_number, '') AS mobile,
          'product'::text AS item_type,
          COALESCE(NULLIF(prod.value->>'name', ''), 'Product') AS item_name,
          COALESCE(NULLIF(prod.value->>'qty', '')::int, NULLIF(prod.value->>'quantity', '')::int, 1) AS quantity,
          COALESCE(NULLIF(prod.value->>'price', '')::numeric, 0) * COALESCE(NULLIF(prod.value->>'qty', '')::numeric, NULLIF(prod.value->>'quantity', '')::numeric, 1) AS revenue_amount,
          NULLIF(prod.value->>'staff_id', '') AS item_staff_id,
          NULLIF(prod.value->>'staff_name', '') AS item_staff_name,
          m.payment_state,
          m.status
        FROM metrics m
        LEFT JOIN clients c
          ON c.id = m.client_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.product_items, '[]'::jsonb)) AS prod(value)
        WHERE ${appointmentWhere.join(" AND ")}

        UNION ALL

        SELECT
          m.id AS appointment_id,
          m.created_at,
          COALESCE(c.full_name, 'Walk-in Client') AS customer_name,
          COALESCE(c.phone_number, '') AS mobile,
          'membership'::text AS item_type,
          COALESCE(NULLIF(mem.value->>'name', ''), 'Membership') AS item_name,
          COALESCE(NULLIF(mem.value->>'qty', '')::int, NULLIF(mem.value->>'quantity', '')::int, 1) AS quantity,
          COALESCE(NULLIF(mem.value->>'price', '')::numeric, 0) * COALESCE(NULLIF(mem.value->>'qty', '')::numeric, NULLIF(mem.value->>'quantity', '')::numeric, 1) AS revenue_amount,
          NULLIF(mem.value->>'staff_id', '') AS item_staff_id,
          NULLIF(mem.value->>'staff_name', '') AS item_staff_name,
          m.payment_state,
          m.status
        FROM metrics m
        LEFT JOIN clients c
          ON c.id = m.client_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(m.membership_items, '[]'::jsonb)) AS mem(value)
        WHERE ${appointmentWhere.join(" AND ")}
      ),
      appointment_line_rows AS (
        SELECT
          ali.created_at AS date,
          CONCAT('APT-', ali.appointment_id::text) AS invoice_no,
          ali.customer_name,
          ali.mobile,
          COALESCE(
            NULLIF(ali.item_staff_name, ''),
            NULLIF(TRIM(CONCAT(COALESCE(st.first_name, ''), ' ', COALESCE(st.last_name, ''))), ''),
            'Unknown'
          ) AS staff_name,
          ali.item_type,
          ali.item_name,
          COALESCE(ali.quantity, 1) AS quantity,
          ROUND(COALESCE(ali.revenue_amount, 0), 2) AS revenue_amount,
          ROUND(COALESCE(slab.commission_value, scs.default_rate, 0), 2) AS commission_rate,
          COALESCE(slab.commission_kind, scs.commission_kind, '-') AS commission_kind,
          ROUND(
            CASE
              WHEN slab.commission_kind = 'percentage'
              THEN COALESCE(ali.revenue_amount, 0) * COALESCE(slab.commission_value, 0) / 100
              WHEN slab.commission_kind = 'fixed_rate'
              THEN
                CASE
                  WHEN COALESCE(slab.revenue_target, 0) > 0
                  THEN FLOOR(COALESCE(ali.revenue_amount, 0) / slab.revenue_target) * COALESCE(slab.commission_value, 0)
                  ELSE COALESCE(slab.commission_value, 0)
                END
              WHEN scs.commission_kind = 'percentage'
              THEN COALESCE(ali.revenue_amount, 0) * COALESCE(scs.default_rate, 0) / 100
              WHEN scs.commission_kind = 'fixed_rate'
              THEN
                CASE
                  WHEN COALESCE(scs.revenue_target, 0) > 0
                  THEN FLOOR(COALESCE(ali.revenue_amount, 0) / scs.revenue_target) * COALESCE(scs.default_rate, 0)
                  ELSE COALESCE(scs.default_rate, 0)
                END
              ELSE 0
            END,
            2
          ) AS commission_amount,
          CASE
            WHEN LOWER(COALESCE(ali.status::text, '')) IN ('cancelled', 'no-show')
                 OR LOWER(COALESCE(ali.payment_state, '')) = 'refunded'
            THEN 'Cancelled'
            ELSE 'Pending'
          END AS payout_status,
          INITCAP(COALESCE(ali.payment_state, 'unpaid')) AS payment_status,
          'Appointment'::text AS source
        FROM appointment_line_items ali
        LEFT JOIN staff st
          ON st.id::text = ali.item_staff_id
        LEFT JOIN staff_commission_settings scs
          ON scs.staff_id::text = ali.item_staff_id
          AND scs.category = ${appointmentCommissionCategoryExpr}
          AND scs.is_enabled = TRUE
        LEFT JOIN LATERAL (
          SELECT
            cs.commission_kind,
            cs.commission_value,
            cs.revenue_target
          FROM commission_slabs cs
          WHERE
            cs.staff_id::text = ali.item_staff_id
            AND cs.category = ${appointmentCommissionCategoryExpr}
            AND cs.is_enabled = TRUE
            AND cs.revenue_target <= COALESCE(ali.revenue_amount, 0)
          ORDER BY
            cs.revenue_target DESC,
            cs.created_at DESC
          LIMIT 1
        ) slab
          ON TRUE
        WHERE COALESCE(ali.item_staff_id, '') <> ''
      ),
      commission_rows AS (
        SELECT * FROM sale_line_rows
        UNION ALL
        SELECT * FROM appointment_line_rows
      )
    `,
  };
};

export const reportsRepository = {
 

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

  let groupExpr = `TO_CHAR(s.created_at, 'Mon YYYY')`;

  if (filters.from && filters.to) {
    const from = new Date(filters.from);
    const to = new Date(filters.to);

    const diffDays =
      Math.floor(
        (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)
      ) + 1;

    if (diffDays === 1) {
      groupExpr = `TO_CHAR(s.created_at, 'HH24:00')`;
    } else if (diffDays <= 7) {
      groupExpr = `TO_CHAR(s.created_at, 'Dy')`;
    } else if (diffDays <= 31) {
      groupExpr = `TO_CHAR(s.created_at, 'DD Mon')`;
    } else {
      groupExpr = `TO_CHAR(s.created_at, 'Mon')`;
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
        TO_CHAR(s.created_at, 'FMDay') AS day_name,
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
        COALESCE(s.tax_amount::numeric, 0) AS tax_amount,
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
        COALESCE(a.id::text, a.service_id::text) AS invoice_number,
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
        COALESCE(NULLIF(s.invoice_number, ''), CONCAT('INV-', s.id::text)) AS invoice_no,
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
        CONCAT('APT-', a.id::text) AS invoice_no,
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

  // Dynamic grouping
  let groupFormat = `TO_CHAR(DATE_TRUNC('month', pr.sale_date), 'Mon YYYY')`;
  let groupBy = `DATE_TRUNC('month', pr.sale_date)`;

  if (filters.from && filters.to) {
    const from = new Date(filters.from);
    const to = new Date(filters.to);

    const diffDays =
      Math.floor(
        (to.getTime() - from.getTime()) /
          (1000 * 60 * 60 * 24)
      ) + 1;

    if (diffDays === 1) {
      groupFormat = `TO_CHAR(DATE_TRUNC('hour', pr.sale_date), 'HH24:00')`;
      groupBy = `DATE_TRUNC('hour', pr.sale_date)`;
    } else if (diffDays <= 7) {
      groupFormat = `TO_CHAR(DATE_TRUNC('day', pr.sale_date), 'Dy')`;
      groupBy = `DATE_TRUNC('day', pr.sale_date)`;
    } else if (diffDays <= 31) {
      groupFormat = `TO_CHAR(DATE_TRUNC('day', pr.sale_date), 'DD Mon')`;
      groupBy = `DATE_TRUNC('day', pr.sale_date)`;
    } else {
      groupFormat = `TO_CHAR(DATE_TRUNC('month', pr.sale_date), 'Mon')`;
      groupBy = `DATE_TRUNC('month', pr.sale_date)`;
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

  let groupExpr = `TO_CHAR(s.created_at, 'Mon YYYY')`;
  let groupByExpr = `DATE_TRUNC('month', s.created_at)`;

  if (filters.from && filters.to) {
    const from = new Date(filters.from);
    const to = new Date(filters.to);

    const diffDays =
      Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    if (diffDays === 1) {
      groupExpr = `TO_CHAR(DATE_TRUNC('hour', s.created_at), 'HH24:00')`;
      groupByExpr = `DATE_TRUNC('hour', s.created_at)`;
    } else if (diffDays <= 7) {
      groupExpr = `TO_CHAR(DATE_TRUNC('day', s.created_at), 'Dy')`;
      groupByExpr = `DATE_TRUNC('day', s.created_at)`;
    } else if (diffDays <= 31) {
      groupExpr = `TO_CHAR(DATE_TRUNC('day', s.created_at), 'DD Mon')`;
      groupByExpr = `DATE_TRUNC('day', s.created_at)`;
    } else {
      groupExpr = `TO_CHAR(DATE_TRUNC('month', s.created_at), 'Mon')`;
      groupByExpr = `DATE_TRUNC('month', s.created_at)`;
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

async getStaffCommissionCards(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const { values, ctes } = buildStaffCommissionSourceQuery(
    salonId,
    filters
  );

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${ctes}
      SELECT
        COALESCE(SUM(commission_amount), 0) AS total_commission,
        COALESCE(SUM(commission_amount) FILTER (WHERE LOWER(payout_status) = 'paid'), 0) AS paid_commission,
        COALESCE(SUM(commission_amount) FILTER (WHERE LOWER(payout_status) = 'pending'), 0) AS pending_commission,
        COUNT(DISTINCT staff_name) AS staff_count,
        COALESCE(SUM(revenue_amount), 0) AS total_revenue,
        COALESCE(
          ROUND(
            CASE
              WHEN COALESCE(SUM(revenue_amount), 0) = 0 THEN 0
              ELSE (SUM(commission_amount) / SUM(revenue_amount)) * 100
            END,
            2
          ),
          0
        ) AS avg_rate
      FROM commission_rows
      `,
      values
    )
  );

  const row = rows[0] ?? {};
  const totalCommission = Number(row.total_commission ?? 0);
  const paidCommission = Number(row.paid_commission ?? 0);
  const pendingCommission = Number(row.pending_commission ?? 0);
  const staffCount = Number(row.staff_count ?? 0);
  const totalRevenue = Number(row.total_revenue ?? 0);
  const avgRate = Number(row.avg_rate ?? 0);

  return [
    {
      title: "Total Commission",
      value: `₹ ${Math.round(totalCommission).toLocaleString("en-IN")}`,
      trend: "0.0%",
      color: "primary",
      icon: "wallet",
    },
    {
      title: "Paid Commission",
      value: `₹ ${Math.round(paidCommission).toLocaleString("en-IN")}`,
      trend: "0.0%",
      color: "success",
      icon: "circle-check",
    },
    {
      title: "Pending Commission",
      value: `₹ ${Math.round(pendingCommission).toLocaleString("en-IN")}`,
      trend: "0.0%",
      color: "warning",
      icon: "clock",
    },
    {
      title: "Staff Earned",
      value: `${staffCount}`,
      trend: "0.0%",
      color: "info",
      icon: "users",
    },
    {
      title: "Revenue Covered",
      value: `₹ ${Math.round(totalRevenue).toLocaleString("en-IN")}`,
      trend: "0.0%",
      color: "purple",
      icon: "chart-line",
    },
    {
      title: "Avg Commission Rate",
      value: `${avgRate.toFixed(2)}%`,
      trend: "0.0%",
      color: "danger",
      icon: "percent",
    },
  ];
},

async getStaffCommissionTrend(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const { values, ctes } = buildStaffCommissionSourceQuery(
    salonId,
    filters
  );

  let groupExpr = `TO_CHAR(DATE_TRUNC('day', date), 'DD Mon')`;
  let orderExpr = `DATE_TRUNC('day', date)`;

  if (filters.from && filters.to) {
    const from = new Date(filters.from);
    const to = new Date(filters.to);
    const diffDays =
      Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;

    if (diffDays === 1) {
      groupExpr = `TO_CHAR(DATE_TRUNC('hour', date), 'HH24:00')`;
      orderExpr = `DATE_TRUNC('hour', date)`;
    } else if (diffDays <= 7) {
      groupExpr = `TO_CHAR(DATE_TRUNC('day', date), 'Dy')`;
      orderExpr = `DATE_TRUNC('day', date)`;
    } else if (diffDays <= 31) {
      groupExpr = `TO_CHAR(DATE_TRUNC('day', date), 'DD Mon')`;
      orderExpr = `DATE_TRUNC('day', date)`;
    } else {
      groupExpr = `TO_CHAR(DATE_TRUNC('month', date), 'Mon YYYY')`;
      orderExpr = `DATE_TRUNC('month', date)`;
    }
  }

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${ctes}
      SELECT
        ${groupExpr} AS day,
        COALESCE(SUM(commission_amount), 0) AS commission
      FROM commission_rows
      GROUP BY ${orderExpr}
      ORDER BY ${orderExpr}
      `,
      values
    )
  );

  return rows.map((row) => ({
    day: row.day,
    commission: Number(row.commission ?? 0),
  }));
},

async getStaffCommissionCategoryBreakdown(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const { values, ctes } = buildStaffCommissionSourceQuery(
    salonId,
    filters
  );

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${ctes}
      SELECT
        INITCAP(REPLACE(item_type, '_', ' ')) AS name,
        COALESCE(SUM(commission_amount), 0) AS value
      FROM commission_rows
      GROUP BY item_type
      ORDER BY value DESC, name ASC
      `,
      values
    )
  );

  return rows.map((row) => ({
    name: row.name,
    value: Number(row.value ?? 0),
  }));
},

async getStaffCommissionTopStaff(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const { values, ctes } = buildStaffCommissionSourceQuery(
    salonId,
    filters
  );

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${ctes}
      SELECT
        staff_name AS name,
        COALESCE(SUM(commission_amount), 0) AS value
      FROM commission_rows
      GROUP BY staff_name
      ORDER BY value DESC, name ASC
      LIMIT 10
      `,
      values
    )
  );

  return rows.map((row) => ({
    name: row.name,
    value: Number(row.value ?? 0),
  }));
},

async getStaffCommissionPayoutStatus(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const { values, ctes } = buildStaffCommissionSourceQuery(
    salonId,
    filters
  );

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${ctes}
      SELECT
        payout_status AS name,
        COALESCE(SUM(commission_amount), 0) AS value
      FROM commission_rows
      GROUP BY payout_status
      ORDER BY value DESC, name ASC
      `,
      values
    )
  );

  return rows.map((row) => ({
    name: row.name,
    value: Number(row.value ?? 0),
  }));
},

async getStaffCommissionAnalytics(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const { values, ctes } = buildStaffCommissionSourceQuery(
    salonId,
    filters
  );

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${ctes},
      totals AS (
        SELECT
          COALESCE(SUM(commission_amount), 0) AS total_commission,
          COALESCE(SUM(commission_amount) FILTER (WHERE LOWER(payout_status) = 'paid'), 0) AS paid_commission,
          COALESCE(SUM(commission_amount) FILTER (WHERE LOWER(payout_status) = 'pending'), 0) AS pending_commission,
          COUNT(DISTINCT staff_name) AS active_staff
        FROM commission_rows
      ),
      staff_rank AS (
        SELECT
          staff_name,
          SUM(commission_amount) AS total_commission
        FROM commission_rows
        GROUP BY staff_name
        ORDER BY total_commission DESC, staff_name ASC
        LIMIT 1
      ),
      category_rank AS (
        SELECT
          INITCAP(REPLACE(item_type, '_', ' ')) AS item_type_name,
          SUM(commission_amount) AS total_commission
        FROM commission_rows
        GROUP BY item_type
        ORDER BY total_commission DESC, item_type_name ASC
        LIMIT 1
      ),
      line_rank AS (
        SELECT
          item_name,
          commission_amount
        FROM commission_rows
        ORDER BY commission_amount DESC, item_name ASC
        LIMIT 1
      )
      SELECT
        COALESCE((SELECT staff_name FROM staff_rank), '-') AS top_staff,
        COALESCE((SELECT total_commission FROM staff_rank), 0) AS top_staff_commission,
        COALESCE((SELECT item_type_name FROM category_rank), '-') AS top_category,
        COALESCE((SELECT total_commission FROM category_rank), 0) AS top_category_commission,
        COALESCE((SELECT item_name FROM line_rank), '-') AS top_item,
        COALESCE((SELECT commission_amount FROM line_rank), 0) AS top_item_commission,
        total_commission,
        paid_commission,
        pending_commission,
        active_staff
      FROM totals
      `,
      values
    )
  );

  const row = rows[0] ?? {};
  const totalCommission = Number(row.total_commission ?? 0);
  const paidCommission = Number(row.paid_commission ?? 0);
  const pendingCommission = Number(row.pending_commission ?? 0);
  const activeStaff = Number(row.active_staff ?? 0);
  const paidRatio =
    totalCommission > 0 ? (paidCommission / totalCommission) * 100 : 0;

  return [
    {
      title: "Top Earning Staff",
      value: row.top_staff ?? "-",
      subtitle: `₹ ${Math.round(Number(row.top_staff_commission ?? 0)).toLocaleString("en-IN")} commission`,
      color: "success",
      icon: "award",
    },
    {
      title: "Top Commission Category",
      value: row.top_category ?? "-",
      subtitle: `₹ ${Math.round(Number(row.top_category_commission ?? 0)).toLocaleString("en-IN")} earned`,
      color: "primary",
      icon: "layer-group",
    },
    {
      title: "Highest Commission Item",
      value: row.top_item ?? "-",
      subtitle: `₹ ${Math.round(Number(row.top_item_commission ?? 0)).toLocaleString("en-IN")} on one line`,
      color: "warning",
      icon: "tags",
    },
    {
      title: "Paid Out Ratio",
      value: `${paidRatio.toFixed(2)}%`,
      subtitle: "Commission already settled",
      color: "info",
      icon: "percent",
    },
    {
      title: "Pending Payout",
      value: `₹ ${Math.round(pendingCommission).toLocaleString("en-IN")}`,
      subtitle: "Commission awaiting payout",
      color: "danger",
      icon: "clock",
    },
    {
      title: "Active Staff",
      value: `${activeStaff}`,
      subtitle: "Staff with commission lines",
      color: "purple",
      icon: "users",
    },
  ];
},

async getStaffCommissionTable(
  salonId: string,
  filters: { from?: string; to?: string }
) {
  const { values, ctes } = buildStaffCommissionSourceQuery(
    salonId,
    filters
  );

  const { rows } = await safeQuery(() =>
    pool.query(
      `
      ${ctes}
      SELECT
        date,
        invoice_no,
        customer_name,
        mobile,
        staff_name,
        INITCAP(REPLACE(item_type, '_', ' ')) AS item_type,
        item_name,
        quantity,
        revenue_amount,
        commission_rate,
        commission_kind,
        commission_amount,
        payout_status,
        payment_status,
        source
      FROM commission_rows
      ORDER BY
        date DESC,
        invoice_no DESC,
        staff_name ASC
      `,
      values
    )
  );

  return {
    rows: rows.map((row) => ({
      date: row.date,
      invoiceNo: row.invoice_no,
      customerName: row.customer_name,
      mobile: row.mobile,
      staffName: row.staff_name,
      itemType: row.item_type,
      itemName: row.item_name,
      quantity: Number(row.quantity ?? 0),
      revenueAmount: Number(row.revenue_amount ?? 0),
      commissionRate: Number(row.commission_rate ?? 0),
      commissionKind: row.commission_kind,
      commissionAmount: Number(row.commission_amount ?? 0),
      payoutStatus: row.payout_status,
      paymentStatus: row.payment_status,
      source: row.source,
    })),
  };
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
        COALESCE(inv.invoice_number_text, a.id::text) ILIKE $${index}
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
        COALESCE(inv.invoice_number_text, a.id::text) AS invoice_no,
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
      LEFT JOIN LATERAL (
        SELECT (
          SELECT COUNT(*)
          FROM appointments a2
          WHERE a2.salon_id = a.salon_id
            AND (
              a2.created_at < a.created_at
              OR (a2.created_at = a.created_at AND a2.id <= a.id)
            )
        )::text AS invoice_number_text
      ) inv
        ON TRUE
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
        TO_CHAR(DATE_TRUNC('day', m.scheduled_at), 'Dy') AS date,
        COUNT(*) AS appointments
      FROM metrics m
      WHERE ${where.join(" AND ")}
      GROUP BY DATE_TRUNC('day', m.scheduled_at)
      ORDER BY DATE_TRUNC('day', m.scheduled_at)
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
        SELECT TO_CHAR(DATE_TRUNC('day', scheduled_at), 'FMDay') AS value
        FROM filtered
        GROUP BY DATE_TRUNC('day', scheduled_at)
        ORDER BY COUNT(*) DESC, DATE_TRUNC('day', scheduled_at) ASC
        LIMIT 1
      ),
      peak_hour AS (
        SELECT
          CONCAT(
            TO_CHAR(DATE_TRUNC('hour', scheduled_at), 'FMHH12 AM'),
            ' - ',
            TO_CHAR(DATE_TRUNC('hour', scheduled_at) + INTERVAL '2 hour', 'FMHH12 AM')
          ) AS value
        FROM filtered
        GROUP BY DATE_TRUNC('hour', scheduled_at)
        ORDER BY COUNT(*) DESC, DATE_TRUNC('hour', scheduled_at) ASC
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
        TO_CHAR(m.scheduled_at, 'YYYY-MM-DD') AS appointment_date,
        TO_CHAR(m.scheduled_at, 'HH12:MI AM') AS appointment_time,
        TO_CHAR(m.created_at, 'YYYY-MM-DD') AS booked_date,
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
          TO_CHAR(s.created_at, 'HH12:MI AM') AS time,
          COALESCE(s.invoice_number, s.id::text) AS ticket_no,
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
        COALESCE(s.invoice_number, inv.invoice_number_text) AS invoice_number,
        m.client_id,
        COALESCE(s.created_at, m.created_at, m.scheduled_at) AS created_at,
        DATE(COALESCE(s.created_at, m.scheduled_at, m.created_at)) AS bill_date,
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
      WHERE
        m.salon_id = $1
        AND LOWER(COALESCE(m.status::text, '')) NOT IN ('cancelled', 'no-show')
    ),
    standalone_sales_base AS (
      SELECT
        s.id,
        s.id AS source_ref_id,
        'sale'::text AS source_type,
        COALESCE(s.invoice_number, s.id::text) AS invoice_number,
        s.client_id,
        s.created_at,
        DATE(s.created_at) AS bill_date,
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
        COALESCE(invoice_number, id::text) AS invoice_no,
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
        DATE(a.scheduled_at) AS appointment_date,
        COUNT(*) FILTER (WHERE a.status = 'paid') AS completed_appointments
      FROM appointments a
      JOIN active_staff s
        ON s.id = a.staff_id
      WHERE
        a.salon_id = $1
        AND DATE(a.scheduled_at) >= $2::date
        AND DATE(a.scheduled_at) <= $3::date
      GROUP BY a.staff_id, DATE(a.scheduled_at)
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
          TO_CHAR(DATE_TRUNC('day', used_at), 'Dy') AS day,
          COUNT(*) AS redemptions,
          COALESCE(SUM(discount_amount), 0) AS discount
        FROM coupon_sales
        GROUP BY DATE_TRUNC('day', used_at)
        ORDER BY DATE_TRUNC('day', used_at)
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
      SELECT TO_CHAR(DATE_TRUNC('day', used_at), 'DD Mon YYYY') AS label, COUNT(*) AS redemptions
      FROM coupon_sales
      GROUP BY DATE_TRUNC('day', used_at)
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

  let trendLabelExpr = `TO_CHAR(DATE_TRUNC('day', payment_date), 'Dy')`;
  let trendDateExpr = `TO_CHAR(DATE_TRUNC('day', payment_date), 'YYYY-MM-DD')`;
  let trendGroupExpr = `DATE_TRUNC('day', payment_date)`;

  if (diffDays > 31 && diffDays <= 120) {
    trendLabelExpr = `CONCAT('Week ', TO_CHAR(DATE_TRUNC('week', payment_date), 'DD Mon'))`;
    trendDateExpr = `TO_CHAR(DATE_TRUNC('week', payment_date), 'YYYY-MM-DD')`;
    trendGroupExpr = `DATE_TRUNC('week', payment_date)`;
  } else if (diffDays > 120) {
    trendLabelExpr = `TO_CHAR(DATE_TRUNC('month', payment_date), 'Mon YYYY')`;
    trendDateExpr = `TO_CHAR(DATE_TRUNC('month', payment_date), 'YYYY-MM-DD')`;
    trendGroupExpr = `DATE_TRUNC('month', payment_date)`;
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
        COALESCE(p.paid_at, p.created_at) AS payment_date,
        DATE(COALESCE(p.paid_at, p.created_at)) AS payment_day,
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
        COALESCE(
          s.invoice_number,
          inv.invoice_number_text
        ) AS invoice_no,
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
      LEFT JOIN LATERAL (
        SELECT (
          SELECT COUNT(*)
          FROM appointments a2
          WHERE a2.salon_id = a.salon_id
            AND (
              a2.created_at < a.created_at
              OR (a2.created_at = a.created_at AND a2.id <= a.id)
            )
        )::text AS invoice_number_text
      ) inv
        ON TRUE
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
        COALESCE(invoice_no, appointment_id::text) AS invoice_no,
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

};
