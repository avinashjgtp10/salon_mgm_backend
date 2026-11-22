import pool, { safeQuery } from "../../config/database";
import { getSalonTimezone } from "../../config/salonTimezone";
import { AppError } from "../../middleware/error.middleware";
import type {
  CashManagementExpenseRecord,
  CashManagementRecord,
  CounterListFilters,
  CreateExpenseBody,
  ExpenseListFilters,
  ExpenseOverview,
  ExpenseOverviewFilters,
  UpdateExpenseBody,
} from "./cash-management.types";
import { reportsRepository } from "../reports/reports.repository";

type DbClient = {
  query: <T = any>(text: string, params?: any[]) => Promise<{ rows: T[]; rowCount: number | null }>;
};

function normalizeExpenseDateInput(expenseDate?: string): string | null {
  if (!expenseDate?.trim()) return null;

  const value = expenseDate.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const now = new Date();
    return `${value}T${now.toISOString().split("T")[1]}`;
  }

  return value;
}

type CounterContext = {
  id: string;
  salon_id: string;
  opening_balance: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
};

const COUNTER_SORT_COLUMNS: Record<string, string> = {
  opened_at: "cm.opened_at",
  created_at: "cm.created_at",
  closing_balance: "cm.closing_balance",
  opening_balance: "cm.opening_balance",
  cash_revenue: "cm.cash_revenue",
  cash_expense: "cm.cash_expense",
  status: "cm.status",
  closed_at: "cm.closed_at",
};

const EXPENSE_SORT_COLUMNS: Record<string, string> = {
  expense_date: "cme.expense_date",
  amount: "cme.amount",
  expense_type: "cme.expense_type",
  payment_method: "cme.payment_method",
  created_at: "cme.created_at",
};

async function getCounterContext(
  client: DbClient,
  cashManagementId: string,
  salonId: string,
): Promise<CounterContext> {
  const { rows } = await client.query<CounterContext>(
    `SELECT id, salon_id, opening_balance, status, opened_at, closed_at
     FROM cash_management
     WHERE id = $1
       AND salon_id = $2`,
    [cashManagementId, salonId],
  );

  const counter = rows[0];
  if (!counter) {
    throw new AppError(404, "Cash counter not found", "CASH_COUNTER_NOT_FOUND");
  }
  return counter;
}

async function recalculateCounterById(client: DbClient, counterId: string, salonId: string) {
  const counter = await getCounterContext(client, counterId, salonId);

  const revenueRows = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(revenue.amount), 0)::numeric AS total
     FROM (
       SELECT
         CASE
           WHEN LOWER(COALESCE(py.payment_method, '')) = 'cash'
             THEN COALESCE(py.paid_amount, py.net_amount, py.amount, 0)::numeric
           ELSE COALESCE((
             SELECT SUM(value::numeric)
             FROM jsonb_each_text(COALESCE(py.split_details, '{}'::jsonb)) AS cash_part(key, value)
             WHERE LOWER(key) = 'cash'
           ), 0::numeric)
         END AS amount
       FROM payments py
       WHERE py.salon_id = $1
         AND py.status IN ('partial', 'completed')
         AND py.updated_at >= $2::timestamptz
         AND py.updated_at <= COALESCE($3::timestamptz, NOW())
         AND (
           LOWER(COALESCE(py.payment_method, '')) = 'cash'
           OR COALESCE((
             SELECT SUM(value::numeric)
             FROM jsonb_each_text(COALESCE(py.split_details, '{}'::jsonb)) AS cash_part(key, value)
             WHERE LOWER(key) = 'cash'
           ), 0::numeric) > 0
         )

       UNION ALL

       SELECT
         CASE
             WHEN LOWER(COALESCE(cp.payment_method, '')) = 'cash'
               THEN COALESCE(cp.paid_amount, 0)::numeric
             ELSE COALESCE((
               SELECT SUM(value::numeric)
               FROM jsonb_each_text(COALESCE(cp.split_details::jsonb, '{}'::jsonb)) AS cash_part(key, value)
               WHERE LOWER(key) = 'cash'
             ), 0::numeric)
           END AS amount
       FROM client_packages cp
       WHERE cp.salon_id = $1
         AND COALESCE(cp.paid_amount, 0) > 0
         AND cp.created_date >= $2::timestamptz
         AND cp.created_date <= COALESCE($3::timestamptz, NOW())

       UNION ALL

       SELECT
         COALESCE(cm.price_paid, 0)::numeric AS amount
       FROM client_memberships cm
       WHERE cm.salon_id = $1
         AND LOWER(COALESCE(cm.payment_method, '')) = 'cash'
         AND COALESCE(cm.price_paid, 0) > 0
         AND cm.purchased_at >= $2::timestamptz
         AND cm.purchased_at <= COALESCE($3::timestamptz, NOW())
     ) revenue`,
    [counter.salon_id, counter.opened_at, counter.closed_at],
  );

  const expenseRows = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::numeric AS total
     FROM cash_management_expenses
     WHERE cash_management_id = $1
       AND COALESCE(payment_method, 'cash') = 'cash'`,   // UPI / Card / … expenses are recorded but never reduce the cash counter
    [counter.id],
  );

  const openingBalance = parseFloat(counter.opening_balance ?? "0");
  const cashRevenue = parseFloat(revenueRows.rows[0]?.total ?? "0");
  const cashExpense = parseFloat(expenseRows.rows[0]?.total ?? "0");
  const closingBalance = openingBalance + cashRevenue - cashExpense;

  const { rows } = await client.query<CashManagementRecord>(
    `UPDATE cash_management
     SET cash_revenue = $2,
         cash_expense = $3,
         closing_balance = $4,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      counter.id,
      cashRevenue.toFixed(2),
      cashExpense.toFixed(2),
      closingBalance.toFixed(2),
    ],
  );

  return rows[0];
}

// Counts how many payments in this counter's session window (opened_at ->
// closed_at, same window recalculateCounterById sums Cash Revenue over) used
// each method. Mirrors that function's cash-leg detection — check the
// authoritative split_details JSON first, falling back to payment_method —
// but does it independently per method instead of collapsing to one, since a
// split payment can genuinely count toward more than one method (e.g. a
// Cash+UPI split is one payment via both).
async function getPaymentMethodCounts(
  client: DbClient,
  salonId: string,
  openedAt: string,
  closedAt: string | null,
) {
  const legAmount = (leg: string) => `COALESCE((
    SELECT SUM(value::numeric)
    FROM jsonb_each_text(COALESCE(py.split_details, '{}'::jsonb)) AS leg(key, value)
    WHERE LOWER(key) = '${leg}'
  ), 0::numeric)`;

  // Amount per method: a straight (non-split) payment attributes its whole
  // paid amount to that one method; a split payment attributes only the
  // leg named in split_details — mirrors the count FILTERs above, but
  // summing amounts instead so a Cash+UPI split correctly credits both
  // methods for their own portion instead of the whole ticket landing on
  // whichever method happened to be recorded last.
  const legOrFull = (leg: string) => `(
    CASE
      WHEN LOWER(COALESCE(py.payment_method, '')) = '${leg}'
        THEN COALESCE(py.paid_amount, py.net_amount, py.amount, 0)::numeric
      ELSE ${legAmount(leg)}
    END
  )`;

  const { rows } = await client.query<{
    upi_count: string; card_count: string; cash_count: string;
    upi_amount: string; card_amount: string; cash_amount: string;
  }>(
    `SELECT
       COUNT(*) FILTER (
         WHERE LOWER(COALESCE(py.payment_method, '')) = 'upi' OR ${legAmount("upi")} > 0
       ) AS upi_count,
       COUNT(*) FILTER (
         WHERE LOWER(COALESCE(py.payment_method, '')) = 'card' OR ${legAmount("card")} > 0
       ) AS card_count,
       COUNT(*) FILTER (
         WHERE LOWER(COALESCE(py.payment_method, '')) = 'cash' OR ${legAmount("cash")} > 0
       ) AS cash_count,
       COALESCE(SUM(${legOrFull("upi")}), 0) AS upi_amount,
       COALESCE(SUM(${legOrFull("card")}), 0) AS card_amount,
       COALESCE(SUM(${legOrFull("cash")}), 0) AS cash_amount
     FROM payments py
     WHERE py.salon_id = $1
       AND py.status IN ('partial', 'completed')
       AND py.updated_at >= $2::timestamptz
       AND py.updated_at <= COALESCE($3::timestamptz, NOW())`,
    [salonId, openedAt, closedAt],
  );

  return {
    upi_count: Number(rows[0]?.upi_count ?? 0),
    card_count: Number(rows[0]?.card_count ?? 0),
    cash_count: Number(rows[0]?.cash_count ?? 0),
    upi_amount: Number(rows[0]?.upi_amount ?? 0),
    card_amount: Number(rows[0]?.card_amount ?? 0),
    cash_amount: Number(rows[0]?.cash_amount ?? 0),
  };
}

// For the WhatsApp close message specifically — unlike getPaymentMethodCounts
// above (bounded by WHEN a payment was actually recorded, correct for the
// live "what's in the till right now" shift view), this bounds by the same
// SERVICE date Daily Sheet and the Dashboard use: appointment.scheduled_at,
// falling back to the linked sale's created_at for a walk-in with no
// appointment. So a bill for yesterday's appointment that only gets paid/
// entered today is correctly left OUT of today's message (Daily Sheet
// already counted it under yesterday) even though the cash physically
// changed hands today — deliberately different from the live shift view,
// which still needs to show that cash as being in today's drawer.
async function getServiceDateBoundedPaymentTotals(
  client: DbClient,
  salonId: string,
  targetDateIso: string,
) {
  const legAmount = (leg: string) => `COALESCE((
    SELECT SUM(value::numeric)
    FROM jsonb_each_text(COALESCE(py.split_details, '{}'::jsonb)) AS leg(key, value)
    WHERE LOWER(key) = '${leg}'
  ), 0::numeric)`;

  const legOrFull = (leg: string) => `(
    CASE
      WHEN LOWER(COALESCE(py.payment_method, '')) = '${leg}'
        THEN COALESCE(py.paid_amount, py.net_amount, py.amount, 0)::numeric
      ELSE ${legAmount(leg)}
    END
  )`;

  const { rows } = await client.query<{
    upi_count: string; card_count: string; cash_count: string;
    upi_amount: string; card_amount: string; cash_amount: string;
  }>(
    `SELECT
       COUNT(*) FILTER (
         WHERE LOWER(COALESCE(py.payment_method, '')) = 'upi' OR ${legAmount("upi")} > 0
       ) AS upi_count,
       COUNT(*) FILTER (
         WHERE LOWER(COALESCE(py.payment_method, '')) = 'card' OR ${legAmount("card")} > 0
       ) AS card_count,
       COUNT(*) FILTER (
         WHERE LOWER(COALESCE(py.payment_method, '')) = 'cash' OR ${legAmount("cash")} > 0
       ) AS cash_count,
       COALESCE(SUM(${legOrFull("upi")}), 0) AS upi_amount,
       COALESCE(SUM(${legOrFull("card")}), 0) AS card_amount,
       COALESCE(SUM(${legOrFull("cash")}), 0) AS cash_amount
     FROM payments py
     LEFT JOIN appointments a ON a.id = py.appointment_id
     LEFT JOIN sales s ON s.appointment_id = py.appointment_id AND s.status = 'completed'
     WHERE py.salon_id = $1
       AND py.status IN ('partial', 'completed')
       AND DATE(COALESCE(a.scheduled_at, s.created_at, py.updated_at) AT TIME ZONE $3) = $2::date`,
    [salonId, targetDateIso, await getSalonTimezone(salonId)],
  );

  return {
    upi_count: Number(rows[0]?.upi_count ?? 0),
    card_count: Number(rows[0]?.card_count ?? 0),
    cash_count: Number(rows[0]?.cash_count ?? 0),
    upi_amount: Number(rows[0]?.upi_amount ?? 0),
    card_amount: Number(rows[0]?.card_amount ?? 0),
    cash_amount: Number(rows[0]?.cash_amount ?? 0),
  };
}

export async function ensureCashManagementTables(): Promise<void> {
  await safeQuery(() =>
    pool.query(`
      CREATE TABLE IF NOT EXISTS cash_management (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        salon_id              UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        status                VARCHAR(20) NOT NULL DEFAULT 'open',
        opening_balance       NUMERIC(12,2) NOT NULL DEFAULT 0,
        cash_revenue          NUMERIC(12,2) NOT NULL DEFAULT 0,
        cash_expense          NUMERIC(12,2) NOT NULL DEFAULT 0,
        closing_balance       NUMERIC(12,2) NOT NULL DEFAULT 0,
        in_store_cash         NUMERIC(12,2),
        reconciliation_amount NUMERIC(12,2),
        remarks               TEXT,
        opened_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        closed_at             TIMESTAMPTZ,
        created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
        closed_by             UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT cash_management_status_check
          CHECK (status IN ('open', 'closed'))
      );
    `),
  );

  await safeQuery(() =>
    pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS cash_management_open_salon_idx
      ON cash_management (salon_id)
      WHERE status = 'open';
    `),
  );

  await safeQuery(() =>
    pool.query(`
      CREATE TABLE IF NOT EXISTS cash_management_expenses (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        cash_management_id UUID NOT NULL REFERENCES cash_management(id) ON DELETE CASCADE,
        salon_id           UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        expense_type       VARCHAR(100) NOT NULL,
        description        TEXT,
        amount             NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
        expense_date       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `),
  );

  // Expenses are independent of the cash counter: new expenses carry no counter, so the link must be optional.
  // (Old expenses keep their counter id and keep counting toward that counter.)
  await safeQuery(() =>
    pool.query(`ALTER TABLE cash_management_expenses ALTER COLUMN cash_management_id DROP NOT NULL`),
  );

  // Paid / Unpaid. Only "paid" expenses count as cash outflow. Existing rows were all real payments, hence the default.
  await safeQuery(() =>
    pool.query(`ALTER TABLE cash_management_expenses ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'paid'`),
  );

  // Payment method of an expense (Cash, UPI, Card…). Existing rows were all cash, hence the default.
  await safeQuery(() =>
    pool.query(`ALTER TABLE cash_management_expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) NOT NULL DEFAULT 'cash'`),
  );

}

export const cashManagementRepository = {
  async openCounter(params: {
    salonId: string;
    openingBalance?: number;
    createdBy: string;
  }) {
    const { salonId, createdBy } = params;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const openRows = await client.query<{ id: string }>(
        `SELECT id
         FROM cash_management
         WHERE salon_id = $1
           AND status = 'open'
         LIMIT 1`,
        [salonId],
      );
      if (openRows.rows[0]) {
        throw new AppError(
          409,
          "An open counter already exists for this salon",
          "COUNTER_ALREADY_OPEN",
        );
      }

      // A counter (open OR closed) for today already means the daily
      // open/close cycle already happened — closing is a one-way action,
      // there is no "reopen" — so a second open the same day must be
      // blocked outright rather than just re-checking for an open row.
      //
      // Both sides must be compared in the salon's business timezone
      // (Asia/Kolkata), not the DB session's default (UTC on RDS) — bare
      // CURRENT_DATE/DATE(opened_at) roll over at UTC midnight, which is
      // 5:30am IST, so for the first ~5.5 hours of a new IST day this was
      // still comparing against the *previous* day's date and wrongly
      // blocking that day's very first Open Counter.
      const todayRows = await client.query<{ id: string }>(
        `SELECT id
         FROM cash_management
         WHERE salon_id = $1
           AND (opened_at AT TIME ZONE $2)::date
             = (NOW() AT TIME ZONE $2)::date
         LIMIT 1`,
        [salonId, await getSalonTimezone(salonId)],
      );
      if (todayRows.rows[0]) {
        throw new AppError(
          409,
          "You can open the cash counter only once per day.",
          "COUNTER_ONCE_PER_DAY",
        );
      }

      const { rows } = await client.query<CashManagementRecord>(
        `INSERT INTO cash_management (
          salon_id, status, opening_balance, closing_balance, created_by
        ) VALUES ($1, 'open', $2, $2, $3)
        RETURNING *`,
        [salonId, (params.openingBalance ?? 0).toFixed(2), createdBy],
      );

      await client.query("COMMIT");
      return rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as any)?.code === "23505") {
        throw new AppError(
          409,
          "An open counter already exists for this salon",
          "COUNTER_ALREADY_OPEN",
        );
      }
      throw error;
    } finally {
      client.release();
    }
  },

  async findCounterForDashboard(salonId: string, cashManagementId?: string) {
    if (cashManagementId) {
      const { rows } = await safeQuery(() =>
        pool.query<CashManagementRecord>(
          `SELECT *
           FROM cash_management
           WHERE id = $1
             AND salon_id = $2
           LIMIT 1`,
          [cashManagementId, salonId],
        ),
      );
      if (!rows[0]) {
        throw new AppError(404, "Cash counter not found", "CASH_COUNTER_NOT_FOUND");
      }
      return rows[0];
    }

    const { rows } = await safeQuery(() =>
      pool.query<CashManagementRecord>(
        `SELECT *
         FROM cash_management
         WHERE salon_id = $1
         ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, opened_at DESC
         LIMIT 1`,
        [salonId],
      ),
    );

    if (!rows[0]) {
      throw new AppError(404, "No cash counter found for this salon", "CASH_COUNTER_NOT_FOUND");
    }
    return rows[0];
  },

  async getDashboardSummary(salonId: string, cashManagementId?: string) {
    let counter: CashManagementRecord;
    try {
      counter = await this.findCounterForDashboard(salonId, cashManagementId);
    } catch (err) {
      // No counter ever opened for this salon (e.g. a brand-new account) is
      // a normal, expected state — not a failure — so it's reported as a
      // 200 with a "nothing yet" summary instead of a 404. A caller that
      // asked for a *specific* counter ID that doesn't exist still gets a
      // real 404, since that IS a genuine lookup error.
      if (!cashManagementId && err instanceof AppError && err.code === "CASH_COUNTER_NOT_FOUND") {
        return {
          cash_management_id: null,
          status: "closed",
          opening_balance: 0,
          cash_revenue: 0,
          cash_expense: 0,
          closing_balance: 0,
          in_store_cash: null,
          reconciliation_amount: null,
          difference: null,
          opened_at: null,
          closed_at: null,
          remarks: null,
          upi_count: 0,
          card_count: 0,
          cash_count: 0,
          upi_amount: 0,
          card_amount: 0,
          cash_amount: 0,
        };
      }
      throw err;
    }
    // A closed counter's figures are frozen at close. Recalculating here
    // re-sums payments by updated_at, so a later edit to an old payment would
    // silently rewrite a finished day (and drift from the saved variance).
    const refreshed = counter.status === "closed"
      ? counter
      : await recalculateCounterById(pool, counter.id, salonId);
    const methodCounts = await getPaymentMethodCounts(
      pool,
      salonId,
      refreshed.opened_at,
      refreshed.closed_at,
    );

    const closingBalance = parseFloat(refreshed.closing_balance ?? "0");
    const inStoreCash = parseFloat(refreshed.in_store_cash ?? "0");
    const reconciliationAmount =
      refreshed.in_store_cash === null ? 0 : parseFloat((inStoreCash - closingBalance).toFixed(2));

    return {
      cash_management_id: refreshed.id,
      status: refreshed.status,
      opening_balance: parseFloat(refreshed.opening_balance ?? "0"),
      cash_revenue: parseFloat(refreshed.cash_revenue ?? "0"),
      cash_expense: parseFloat(refreshed.cash_expense ?? "0"),
      closing_balance: closingBalance,
      in_store_cash: refreshed.in_store_cash === null ? null : inStoreCash,
      reconciliation_amount: refreshed.in_store_cash === null ? null : reconciliationAmount,
      difference: refreshed.in_store_cash === null ? null : reconciliationAmount,
      opened_at: refreshed.opened_at,
      closed_at: refreshed.closed_at,
      remarks: refreshed.remarks,
      upi_count: methodCounts.upi_count,
      card_count: methodCounts.card_count,
      cash_count: methodCounts.cash_count,
      upi_amount: methodCounts.upi_amount,
      card_amount: methodCounts.card_amount,
      cash_amount: methodCounts.cash_amount,
    };
  },

  // Itemized breakdown of the individual cash payments (Quick Sale,
  // Calendar/Appointment checkout, Package, Membership) that make up a
  // counter's cash_revenue total — the same sources recalculateCounterById
  // sums, just returned as rows instead of a single total, so the UI can
  // show each payment rather than only the aggregate figure.
  async listCashIncomeEntries(params: { salonId: string; cashManagementId: string }) {
    const counter = await getCounterContext(pool, params.cashManagementId, params.salonId);

    const { rows } = await safeQuery(() =>
      pool.query(
        `SELECT * FROM (
          SELECT
            py.id::text AS id,
            py.updated_at AS occurred_at,
            CASE WHEN py.appointment_id IS NULL THEN 'Quick Sale' ELSE 'Appointment' END AS source,
            COALESCE(s.invoice_number, '') AS reference,
            COALESCE(c.full_name, 'Walk-in') AS client_name,
            CASE
              WHEN LOWER(COALESCE(py.payment_method, '')) = 'cash'
                THEN COALESCE(py.paid_amount, py.net_amount, py.amount, 0)::numeric
              ELSE COALESCE((
                SELECT SUM(value::numeric)
                FROM jsonb_each_text(COALESCE(py.split_details, '{}'::jsonb)) AS cash_part(key, value)
                WHERE LOWER(key) = 'cash'
              ), 0::numeric)
            END AS amount
          FROM payments py
          LEFT JOIN sales s ON s.appointment_id = py.appointment_id AND s.salon_id = py.salon_id
          LEFT JOIN clients c ON c.id = py.client_id
          WHERE py.salon_id = $1
            AND py.status IN ('partial', 'completed')
            AND py.updated_at >= $2::timestamptz
            AND py.updated_at <= COALESCE($3::timestamptz, NOW())
            AND (
              LOWER(COALESCE(py.payment_method, '')) = 'cash'
              OR COALESCE((
                SELECT SUM(value::numeric)
                FROM jsonb_each_text(COALESCE(py.split_details, '{}'::jsonb)) AS cash_part(key, value)
                WHERE LOWER(key) = 'cash'
              ), 0::numeric) > 0
            )

          UNION ALL

          SELECT
            cp.id::text AS id,
            cp.created_date AS occurred_at,
            'Package' AS source,
            COALESCE(cp.package_name, '') AS reference,
            COALESCE(cp.client_name, 'Walk-in') AS client_name,
            CASE
             WHEN LOWER(COALESCE(cp.payment_method, '')) = 'cash'
               THEN COALESCE(cp.paid_amount, 0)::numeric
             ELSE COALESCE((
               SELECT SUM(value::numeric)
               FROM jsonb_each_text(COALESCE(cp.split_details::jsonb, '{}'::jsonb)) AS cash_part(key, value)
               WHERE LOWER(key) = 'cash'
             ), 0::numeric)
           END AS amount
          FROM client_packages cp
          WHERE cp.salon_id = $1
            AND COALESCE(cp.paid_amount, 0) > 0
            AND cp.created_date >= $2::timestamptz
            AND cp.created_date <= COALESCE($3::timestamptz, NOW())

          UNION ALL

          SELECT
            cm.id::text AS id,
            cm.purchased_at AS occurred_at,
            'Membership' AS source,
            COALESCE(cm.membership_name, '') AS reference,
            COALESCE(cm.client_name, 'Walk-in') AS client_name,
            COALESCE(cm.price_paid, 0)::numeric AS amount
          FROM client_memberships cm
          WHERE cm.salon_id = $1
            AND LOWER(COALESCE(cm.payment_method, '')) = 'cash'
            AND COALESCE(cm.price_paid, 0) > 0
            AND cm.purchased_at >= $2::timestamptz
            AND cm.purchased_at <= COALESCE($3::timestamptz, NOW())
        ) entries
        WHERE amount > 0
        ORDER BY occurred_at DESC`,
        [params.salonId, counter.opened_at, counter.closed_at],
      ),
    );

    return rows.map((row: any) => ({
      id: row.id,
      occurred_at: row.occurred_at,
      source: row.source,
      reference: row.reference || null,
      client_name: row.client_name,
      amount: parseFloat(row.amount ?? "0"),
    }));
  },

  async listCounters(filters: CounterListFilters) {
    const values: any[] = [filters.salonId];
    const where: string[] = ["cm.salon_id = $1"];
    let idx = 2;

    if (filters.status) {
      where.push(`cm.status = $${idx++}`);
      values.push(filters.status);
    }
    if (filters.from) {
      where.push(`DATE(cm.opened_at) >= $${idx++}::date`);
      values.push(filters.from);
    }
    if (filters.to) {
      where.push(`DATE(cm.opened_at) <= $${idx++}::date`);
      values.push(filters.to);
    }
    if (filters.search) {
      where.push(`(
        COALESCE(u.full_name, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))) ILIKE $${idx}
        OR COALESCE(cu.full_name, TRIM(COALESCE(cu.first_name, '') || ' ' || COALESCE(cu.last_name, ''))) ILIKE $${idx}
        OR COALESCE(cm.remarks, '') ILIKE $${idx}
      )`);
      values.push(`%${filters.search}%`);
      idx += 1;
    }

    const sortColumn = COUNTER_SORT_COLUMNS[filters.sortBy ?? "opened_at"] ?? COUNTER_SORT_COLUMNS.opened_at;
    const sortOrder = filters.sortOrder === "asc" ? "ASC" : "DESC";
    const hasPagination = typeof filters.limit === "number" && filters.limit > 0;
    const page = hasPagination ? Math.max(filters.page ?? 1, 1) : 1;
    const offset = hasPagination ? (page - 1) * (filters.limit as number) : 0;
    const filterValues = values.slice();

    const countQuery = `SELECT COUNT(*)::int AS total
      FROM cash_management cm
      LEFT JOIN users u ON u.id = cm.created_by
      LEFT JOIN users cu ON cu.id = cm.closed_by
      WHERE ${where.join(" AND ")}`;

    let dataQuery = `SELECT
        cm.*,
        COALESCE(u.full_name, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))) AS created_by_name,
        COALESCE(cu.full_name, TRIM(COALESCE(cu.first_name, '') || ' ' || COALESCE(cu.last_name, ''))) AS closed_by_name
      FROM cash_management cm
      LEFT JOIN users u ON u.id = cm.created_by
      LEFT JOIN users cu ON cu.id = cm.closed_by
      WHERE ${where.join(" AND ")}
      ORDER BY ${sortColumn} ${sortOrder}`;

    const dataValues = [...filterValues];
    if (hasPagination) {
      dataQuery += ` LIMIT $${idx} OFFSET $${idx + 1}`;
      dataValues.push(filters.limit as number, offset);
    }

    const [countResult, dataResult] = await Promise.all([
      safeQuery(() => pool.query<{ total: number }>(countQuery, filterValues)),
      safeQuery(() => pool.query<any>(dataQuery, dataValues)),
    ]);

    return {
      items: dataResult.rows.map((row) => ({
        id: row.id,
        status: row.status,
        opening_balance: parseFloat(row.opening_balance ?? "0"),
        cash_revenue: parseFloat(row.cash_revenue ?? "0"),
        cash_expense: parseFloat(row.cash_expense ?? "0"),
        closing_balance: parseFloat(row.closing_balance ?? "0"),
        in_store_cash: row.in_store_cash === null ? null : parseFloat(row.in_store_cash),
        reconciliation_amount:
          row.reconciliation_amount === null ? null : parseFloat(row.reconciliation_amount),
        remarks: row.remarks,
        opened_at: row.opened_at,
        closed_at: row.closed_at,
        created_by: row.created_by,
        created_by_name: row.created_by_name,
        closed_by: row.closed_by,
        closed_by_name: row.closed_by_name,
      })),
      pagination: {
        page,
        limit: filters.limit ?? null,
        total: Number(countResult.rows[0]?.total ?? 0),
      },
    };
  },

  async listExpenses(filters: ExpenseListFilters) {
    const values: any[] = [filters.salonId];
    const where: string[] = ["cme.salon_id = $1"];
    let idx = 2;

    if (filters.cashManagementId) {
      where.push(`cme.cash_management_id = $${idx++}`);
      values.push(filters.cashManagementId);
    }
    if (filters.search) {
      where.push(`(
        cme.expense_type ILIKE $${idx}
        OR COALESCE(cme.payment_method, 'cash') ILIKE $${idx}
        OR COALESCE(cme.description, '') ILIKE $${idx}
        OR COALESCE(u.full_name, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))) ILIKE $${idx}
      )`);
      values.push(`%${filters.search}%`);
      idx += 1;
    }

    const sortColumn = EXPENSE_SORT_COLUMNS[filters.sortBy ?? "expense_date"] ?? EXPENSE_SORT_COLUMNS.expense_date;
    const sortOrder = filters.sortOrder === "asc" ? "ASC" : "DESC";
    const hasPagination = typeof filters.limit === "number" && filters.limit > 0;
    const page = hasPagination ? Math.max(filters.page ?? 1, 1) : 1;
    const offset = hasPagination ? (page - 1) * (filters.limit as number) : 0;
    const filterValues = values.slice();

    const countQuery = `SELECT COUNT(*)::int AS total
      FROM cash_management_expenses cme
      LEFT JOIN cash_management cm ON cm.id = cme.cash_management_id
      LEFT JOIN users u ON u.id = cme.created_by
      WHERE ${where.join(" AND ")}`;

    let dataQuery = `SELECT
        cme.*,
        cm.status AS transaction_status,
        cm.opened_at AS transaction_opened_at,
        cm.closed_at AS transaction_closed_at,
        COALESCE(u.full_name, TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, ''))) AS created_by_name
      FROM cash_management_expenses cme
      LEFT JOIN cash_management cm ON cm.id = cme.cash_management_id
      LEFT JOIN users u ON u.id = cme.created_by
      WHERE ${where.join(" AND ")}
      ORDER BY ${sortColumn} ${sortOrder}`;

    const dataValues = [...filterValues];
    if (hasPagination) {
      dataQuery += ` LIMIT $${idx} OFFSET $${idx + 1}`;
      dataValues.push(filters.limit as number, offset);
    }

    const [countResult, dataResult] = await Promise.all([
      safeQuery(() => pool.query<{ total: number }>(countQuery, filterValues)),
      safeQuery(() => pool.query<any>(dataQuery, dataValues)),
    ]);

    return {
      items: dataResult.rows.map((row) => ({
        id: row.id,
        cash_management_id: row.cash_management_id,
        expense_date: row.expense_date,
        expense_type: row.expense_type,
        payment_method: row.payment_method ?? "cash",
        status: row.status ?? "paid",
        description: row.description,
        amount: parseFloat(row.amount ?? "0"),
        created_by: row.created_by,
        created_by_name: row.created_by_name,
        created_at: row.created_at,
        transaction_status: row.transaction_status,
        transaction_opened_at: row.transaction_opened_at,
        transaction_closed_at: row.transaction_closed_at,
      })),
      pagination: {
        page,
        limit: filters.limit ?? null,
        total: Number(countResult.rows[0]?.total ?? 0),
      },
    };
  },

  /**
   * Cash Management -> All Expense overview. Every figure comes straight from the database, once:
   *  - revenue: the Sales Summary report's own queries (the figure the dashboard shows), so a sale is never counted twice;
   *  - expenses: one row per cash_management_expenses record. Only status = 'paid' is outflow; unpaid is reported on its own.
   * Net cash flow = revenue - paid expenses.
   */
  async getExpenseOverview(filters: ExpenseOverviewFilters): Promise<ExpenseOverview> {
    const { salonId, from, to } = filters;
    const tz = `COALESCE((SELECT NULLIF(timezone, '') FROM salons WHERE id = $1), 'Asia/Kolkata')`;
    const expenseDay = `TO_CHAR(cme.expense_date AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;

    const where: string[] = ["cme.salon_id = $1"];
    const values: any[] = [salonId];
    if (from) { values.push(from); where.push(`${expenseDay} >= $${values.length}`); }
    if (to) { values.push(to); where.push(`${expenseDay} <= $${values.length}`); }
    const whereSql = where.join(" AND ");

    const revenueFilters = { start_date: from, end_date: to, payment_statuses: ["paid", "partial"] };

    const [stats, revenueDaily, totals, expenseDaily, categories] = await Promise.all([
      reportsRepository.getSalesSummaryReportStats(salonId, revenueFilters),
      reportsRepository.getSalesSummaryReportChart(salonId, revenueFilters, "day"),
      safeQuery(() => pool.query<any>(
        `SELECT
           COALESCE(SUM(cme.amount) FILTER (WHERE COALESCE(cme.status, 'paid') = 'paid'), 0)::float8 AS paid_total,
           COALESCE(SUM(cme.amount) FILTER (WHERE cme.status = 'unpaid'), 0)::float8 AS unpaid_total,
           COUNT(*) FILTER (WHERE COALESCE(cme.status, 'paid') = 'paid')::int AS paid_count,
           COUNT(*) FILTER (WHERE cme.status = 'unpaid')::int AS unpaid_count
         FROM cash_management_expenses cme
         WHERE ${whereSql}`, values)),
      safeQuery(() => pool.query<any>(
        `SELECT ${expenseDay} AS day, COALESCE(SUM(cme.amount), 0)::float8 AS amount
         FROM cash_management_expenses cme
         WHERE ${whereSql} AND COALESCE(cme.status, 'paid') = 'paid'
         GROUP BY day ORDER BY day ASC`, values)),
      safeQuery(() => pool.query<any>(
        `SELECT cme.expense_type AS name, COALESCE(SUM(cme.amount), 0)::float8 AS amount, COUNT(*)::int AS count
         FROM cash_management_expenses cme
         WHERE ${whereSql} AND COALESCE(cme.status, 'paid') = 'paid'
         GROUP BY cme.expense_type ORDER BY amount DESC`, values)),
    ]);

    const totalRevenue = Number(stats.received_amount) || 0;
    const paidTotal = Number(totals.rows[0]?.paid_total) || 0;

    // One row per calendar day, revenue and paid expenses side by side.
    const byDay = new Map<string, { date: string; revenue: number; expenses: number }>();
    const slot = (d: string) => {
      let r = byDay.get(d);
      if (!r) { r = { date: d, revenue: 0, expenses: 0 }; byDay.set(d, r); }
      return r;
    };
    revenueDaily.forEach((r) => { slot(r.date).revenue += Number(r.received_amount) || 0; });
    expenseDaily.rows.forEach((r: any) => { slot(String(r.day)).expenses += Number(r.amount) || 0; });

    return {
      total_revenue: totalRevenue,
      total_expenses: paidTotal,
      unpaid_expenses: Number(totals.rows[0]?.unpaid_total) || 0,
      paid_count: Number(totals.rows[0]?.paid_count) || 0,
      unpaid_count: Number(totals.rows[0]?.unpaid_count) || 0,
      net_cash_flow: Math.round((totalRevenue - paidTotal) * 100) / 100,
      daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      categories: categories.rows.map((r: any) => ({ name: String(r.name), amount: Number(r.amount) || 0, count: Number(r.count) || 0 })),
    };
  },

  async createExpense(params: {
    salonId: string;
    createdBy: string;
    body: CreateExpenseBody;
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Independent of the cash counter: no counter lookup, no "counter closed" rule, no counter recalculation.
      const { rows } = await client.query<CashManagementExpenseRecord>(
        `INSERT INTO cash_management_expenses (
          cash_management_id, salon_id, expense_type, description, amount, expense_date, created_by, payment_method, status
        ) VALUES (NULL, $1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), $6, $7, $8)
        RETURNING *`,
        [
          params.salonId,
          params.body.expense_type.trim(),
          params.body.description?.trim() || null,
          params.body.amount.toFixed(2),
          normalizeExpenseDateInput(params.body.expense_date),
          params.createdBy,
          params.body.payment_method ?? "cash",
          params.body.status ?? "paid",
        ],
      );

      await client.query("COMMIT");
      return { expense: rows[0] };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async updateExpense(params: {
    salonId: string;
    expenseId: string;
    body: UpdateExpenseBody;
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const expenseRows = await client.query<CashManagementExpenseRecord>(
        `SELECT *
         FROM cash_management_expenses
         WHERE id = $1
           AND salon_id = $2`,
        [params.expenseId, params.salonId],
      );

      const expense = expenseRows.rows[0];
      if (!expense) {
        throw new AppError(404, "Expense not found", "EXPENSE_NOT_FOUND");
      }

      if (
        params.body.expense_type === undefined &&
        params.body.description === undefined &&
        params.body.amount === undefined &&
        params.body.payment_method === undefined &&
        params.body.status === undefined &&
        params.body.expense_date === undefined
      ) {
        throw new AppError(400, "At least one expense field is required", "VALIDATION_ERROR");
      }

      const setParts: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (params.body.expense_type !== undefined) {
        setParts.push(`expense_type = $${idx++}`);
        values.push(params.body.expense_type.trim());
      }
      if (params.body.payment_method !== undefined) {
        setParts.push(`payment_method = $${idx++}`);
        values.push(params.body.payment_method);
      }
      if (params.body.status !== undefined) {
        setParts.push(`status = $${idx++}`);
        values.push(params.body.status);
      }
      if (params.body.description !== undefined) {
        setParts.push(`description = $${idx++}`);
        values.push(params.body.description.trim() || null);
      }
      if (params.body.amount !== undefined) {
        setParts.push(`amount = $${idx++}`);
        values.push(params.body.amount.toFixed(2));
      }
      if (params.body.expense_date !== undefined) {
        setParts.push(`expense_date = $${idx++}`);
        values.push(normalizeExpenseDateInput(params.body.expense_date));
      }
      setParts.push(`updated_at = NOW()`);

      const { rows } = await client.query<CashManagementExpenseRecord>(
        `UPDATE cash_management_expenses
         SET ${setParts.join(", ")}
         WHERE id = $${idx}
         RETURNING *`,
        [...values, params.expenseId],
      );

      await client.query("COMMIT");
      return { expense: rows[0] };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async deleteExpense(params: { salonId: string; expenseId: string }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const expenseRows = await client.query<CashManagementExpenseRecord>(
        `SELECT *
         FROM cash_management_expenses
         WHERE id = $1
           AND salon_id = $2`,
        [params.expenseId, params.salonId],
      );

      const expense = expenseRows.rows[0];
      if (!expense) {
        throw new AppError(404, "Expense not found", "EXPENSE_NOT_FOUND");
      }

      await client.query(`DELETE FROM cash_management_expenses WHERE id = $1`, [params.expenseId]);

      await client.query("COMMIT");
      return { deleted: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  async closeCounter(params: {
    salonId: string;
    cashManagementId: string;
    inStoreCash: number;
    remarks?: string;
    closedBy: string;
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const counter = await getCounterContext(client, params.cashManagementId, params.salonId);
      if (counter.status !== "open") {
        throw new AppError(
          409,
          "Cash counter is already closed.",
          "COUNTER_ALREADY_CLOSED",
        );
      }

      const refreshed = await recalculateCounterById(client, params.cashManagementId, params.salonId);
      const closingBalance = parseFloat(refreshed.closing_balance ?? "0");
      const reconciliationAmount = params.inStoreCash - closingBalance;

      const { rows } = await client.query<CashManagementRecord>(
        `UPDATE cash_management
         SET in_store_cash = $2,
             reconciliation_amount = $3,
             remarks = $4,
             status = 'closed',
             closed_by = $5,
             closed_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          params.cashManagementId,
          params.inStoreCash.toFixed(2),
          reconciliationAmount.toFixed(2),
          params.remarks?.trim() || null,
          params.closedBy,
        ],
      );

      // The WhatsApp close message reports THIS CALENDAR DATE's collection
      // (Asia/Kolkata), by SERVICE date (same as Daily Sheet/Dashboard) —
      // not the raw shift window, and not by when the payment happened to be
      // recorded. So a bill for yesterday's appointment that gets paid/
      // entered today is correctly excluded (Daily Sheet already counted it
      // under yesterday), even though the cash changed hands today. Dated to
      // the IST day the counter was OPENED on.
      const openedDate = await client.query<{ ist_date: string }>(
        `SELECT (date_trunc('day', $1::timestamptz AT TIME ZONE $2))::date AS ist_date`,
        [rows[0].opened_at, await getSalonTimezone(params.salonId)],
      );

      const methodCounts = await getServiceDateBoundedPaymentTotals(
        client,
        params.salonId,
        openedDate.rows[0].ist_date,
      );

      await client.query("COMMIT");
      return {
        ...rows[0],
        upi_count: methodCounts.upi_count,
        card_count: methodCounts.card_count,
        cash_count: methodCounts.cash_count,
        upi_amount: methodCounts.upi_amount,
        card_amount: methodCounts.card_amount,
        cash_amount: methodCounts.cash_amount,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  // Edit an opened or closed counter. Runs in one transaction with the row locked, writes an audit row
  // (cash_management_edits: old/new values + who) and returns the LATEST saved row. Nothing is returned (and so nothing
  // is announced by WhatsApp) unless the whole transaction committed.
  //  - open:   opening_balance only; revenue/expense/closing are re-derived from the live payments/expenses.
  //  - closed: opening_balance, in_store_cash, remarks. A closed counter's revenue/expense are frozen at close, so closing
  //            balance = new opening + frozen cash revenue - frozen cash expense, and reconciliation = in-store - closing.
  async editCounter(params: {
    salonId: string;
    cashManagementId: string;
    editedBy: string;
    changes: { openingBalance?: number; closingBalance?: number; inStoreCash?: number; remarks?: string | null };
  }) {
    const { salonId, cashManagementId, editedBy, changes } = params;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: lockRows } = await client.query<CashManagementRecord>(
        `SELECT * FROM cash_management WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
        [cashManagementId, salonId],
      );
      const before = lockRows[0];
      if (!before) throw new AppError(404, "Cash counter not found", "CASH_COUNTER_NOT_FOUND");

      const isClosed = before.status === "closed";
      if (!isClosed && (changes.inStoreCash !== undefined || changes.remarks !== undefined)) {
        throw new AppError(400, "In-store cash and remarks can only be edited once the counter is closed.", "VALIDATION_ERROR");
      }

      const openingBalance = changes.openingBalance ?? parseFloat(before.opening_balance ?? "0");
      let after: CashManagementRecord;

      if (!isClosed) {
        await client.query(
          `UPDATE cash_management SET opening_balance = $2, updated_at = NOW() WHERE id = $1`,
          [cashManagementId, openingBalance.toFixed(2)],
        );
        after = await recalculateCounterById(client, cashManagementId, salonId);
        // Opening and closing are independent: a typed closing balance replaces the derived one. (An open counter's
        // closing is re-derived again the next time a payment or expense is recorded.)
        if (changes.closingBalance !== undefined) {
          const { rows } = await client.query<CashManagementRecord>(
            `UPDATE cash_management SET closing_balance = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [cashManagementId, changes.closingBalance.toFixed(2)],
          );
          after = rows[0];
        }
      } else {
        const inStoreCash = changes.inStoreCash ?? (before.in_store_cash === null ? 0 : parseFloat(before.in_store_cash));
        // Independent of the opening balance: unless a new closing balance is typed, the saved one stays as it was.
        const closingBalance = changes.closingBalance ?? parseFloat(before.closing_balance ?? "0");
        const remarks = changes.remarks !== undefined ? changes.remarks?.toString().trim() || null : before.remarks;
        const { rows } = await client.query<CashManagementRecord>(
          `UPDATE cash_management
           SET opening_balance = $2,
               closing_balance = $3,
               in_store_cash = $4,
               reconciliation_amount = $5,
               remarks = $6,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [
            cashManagementId,
            openingBalance.toFixed(2),
            closingBalance.toFixed(2),
            inStoreCash.toFixed(2),
            (inStoreCash - closingBalance).toFixed(2),
            remarks,
          ],
        );
        after = rows[0];
      }

      const snapshot = (r: CashManagementRecord) => ({
        status: r.status,
        opening_balance: r.opening_balance,
        cash_revenue: r.cash_revenue,
        cash_expense: r.cash_expense,
        closing_balance: r.closing_balance,
        in_store_cash: r.in_store_cash,
        reconciliation_amount: r.reconciliation_amount,
        remarks: r.remarks,
      });
      await client.query(
        `INSERT INTO cash_management_edits (cash_management_id, salon_id, edited_by, old_values, new_values)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
        [cashManagementId, salonId, editedBy, JSON.stringify(snapshot(before)), JSON.stringify(snapshot(after))],
      );

      // Cash/Card/UPI for the WhatsApp summary: same service-date-bounded totals the original close message used.
      let methodCounts: Awaited<ReturnType<typeof getServiceDateBoundedPaymentTotals>> | null = null;
      if (isClosed) {
        const openedDate = await client.query<{ ist_date: string }>(
          `SELECT (date_trunc('day', $1::timestamptz AT TIME ZONE $2))::date AS ist_date`,
          [after.opened_at, await getSalonTimezone(salonId)],
        );
        methodCounts = await getServiceDateBoundedPaymentTotals(client, salonId, openedDate.rows[0].ist_date);
      }

      await client.query("COMMIT");
      return { ...after, ...(methodCounts ?? {}) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  // Dashboard > Overall Collection's "Resend to WhatsApp" action (Yesterday
  // only) — finds the counter whose OPEN date matches the requested date,
  // same anchor closeCounter() itself uses for that day's message. Most
  // recent close wins if more than one counter happened to open that day.
  async findClosedCounterByOpenedDate(salonId: string, dateIso: string): Promise<CashManagementRecord | null> {
    const { rows } = await pool.query<CashManagementRecord>(
      `SELECT * FROM cash_management
       WHERE salon_id = $1
         AND status = 'closed'
         AND DATE(opened_at AT TIME ZONE $3) = $2::date
       ORDER BY closed_at DESC
       LIMIT 1`,
      [salonId, dateIso, await getSalonTimezone(salonId)],
    );
    return rows[0] ?? null;
  },

  // Cash/Card/UPI amounts were only ever computed transiently at close time
  // (see closeCounter() above) — never persisted as their own columns — so a
  // resend days later has to recompute them the same service-date-bounded
  // way, keyed to the same date closeCounter() itself used.
  async getCollectionTotalsForDate(salonId: string, dateIso: string) {
    return getServiceDateBoundedPaymentTotals(pool, salonId, dateIso);
  },
};
