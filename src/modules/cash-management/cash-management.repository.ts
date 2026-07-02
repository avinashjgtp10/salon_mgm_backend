import pool, { safeQuery } from "../../config/database";
import { AppError } from "../../middleware/error.middleware";
import type {
  CashManagementExpenseRecord,
  CashManagementRecord,
  CounterListFilters,
  CreateExpenseBody,
  ExpenseListFilters,
  UpdateExpenseBody,
} from "./cash-management.types";

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
  created_at: "cme.created_at",
};

// const cashRevenueUnionSql = `
//   SELECT SUM(amount)::numeric AS total
//   FROM (
//     SELECT
//       CASE
//         WHEN py.payment_method = 'cash' THEN COALESCE(py.paid_amount, py.net_amount, py.amount, 0)::numeric
//         WHEN py.payment_method = 'split' THEN COALESCE(NULLIF(py.split_details->>'cash', '')::numeric, 0)
//         ELSE 0::numeric
//       END AS amount
//     FROM payments py
//     JOIN appointments a
//       ON a.id = py.appointment_id
//     WHERE py.salon_id = $1
//       AND a.branch_id = $2
//       AND py.status IN ('partial', 'completed')
//       AND COALESCE(py.paid_at, py.created_at) >= $3::timestamptz
//       AND COALESCE(py.paid_at, py.created_at) <= COALESCE($4::timestamptz, NOW())
//       AND (
//         py.payment_method = 'cash'
//         OR (
//           py.payment_method = 'split'
//           AND py.split_details IS NOT NULL
//           AND COALESCE(NULLIF(py.split_details->>'cash', '')::numeric, 0) > 0
//         )
//       )

//     UNION ALL

//     SELECT
//       CASE
//         WHEN s.payment_method = 'cash' THEN COALESCE(s.total_amount, 0)::numeric
//         WHEN s.payment_method = 'split' THEN COALESCE(NULLIF(py.split_details->>'cash', '')::numeric, 0)
//         ELSE 0::numeric
//       END AS amount
//     FROM sales s
//     JOIN staff st
//       ON st.id = s.staff_id
//     LEFT JOIN payments py
//       ON py.salon_id = s.salon_id
//      AND py.notes = ('Payment for Sale ID: ' || s.id)
//     WHERE s.salon_id = $1
//       AND st.branch_id = $2
//       AND s.appointment_id IS NULL
//       AND s.status = 'completed'
//       AND s.created_at >= $3::timestamptz
//       AND s.created_at <= COALESCE($4::timestamptz, NOW())
//       AND (
//         s.payment_method = 'cash'
//         OR (
//           s.payment_method = 'split'
//           AND COALESCE(NULLIF(py.split_details->>'cash', '')::numeric, 0) > 0
//         )
//       )
//   ) cash_revenue
// `;

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
         COALESCE(cp.paid_amount, 0)::numeric AS amount
       FROM client_packages cp
       WHERE cp.salon_id = $1
         AND LOWER(COALESCE(cp.payment_method, '')) = 'cash'
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
     WHERE cash_management_id = $1`,
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

  // async findCounterForDashboard(salonId: string, branchId: string, cashManagementId?: string) {
  //   await assertBranchInSalon(branchId, salonId);
  //
  //   if (cashManagementId) {
  //     const { rows } = await safeQuery(() =>
  //       pool.query<CashManagementRecord>(
  //         `SELECT *
  //          FROM cash_management
  //          WHERE id = $1
  //            AND salon_id = $2
  //            AND branch_id = $3
  //          LIMIT 1`,
  //         [cashManagementId, salonId, branchId],
  //       ),
  //     );
  //     if (!rows[0]) {
  //       throw new AppError(404, "Cash counter not found", "CASH_COUNTER_NOT_FOUND");
  //     }
  //     return rows[0];
  //   }
  //
  //   const { rows } = await safeQuery(() =>
  //     pool.query<CashManagementRecord>(
  //       `SELECT *
  //        FROM cash_management
  //        WHERE salon_id = $1
  //          AND branch_id = $2
  //        ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, opened_at DESC
  //        LIMIT 1`,
  //       [salonId, branchId],
  //     ),
  //   );
  //
  //   if (!rows[0]) {
  //     throw new AppError(404, "No cash counter found for this branch", "CASH_COUNTER_NOT_FOUND");
  //   }
  //   return rows[0];
  // },

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
    const counter = await this.findCounterForDashboard(salonId, cashManagementId);
    const refreshed = await recalculateCounterById(pool, counter.id, salonId);

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
    };
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

  async createExpense(params: {
    salonId: string;
    createdBy: string;
    body: CreateExpenseBody;
  }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const counter = await getCounterContext(client, params.body.cash_management_id, params.salonId);
      if (counter.status !== "open") {
        throw new AppError(400, "Cannot add expense to a closed counter", "COUNTER_CLOSED");
      }

      const { rows } = await client.query<CashManagementExpenseRecord>(
        `INSERT INTO cash_management_expenses (
          cash_management_id, salon_id, expense_type, description, amount, expense_date, created_by
        ) VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), $7)
        RETURNING *`,
        [
          params.body.cash_management_id,
          params.salonId,
          params.body.expense_type.trim(),
          params.body.description?.trim() || null,
          params.body.amount.toFixed(2),
          normalizeExpenseDateInput(params.body.expense_date),
          params.createdBy,
        ],
      );

      const counterSummary = await recalculateCounterById(client, params.body.cash_management_id, params.salonId);

      await client.query("COMMIT");
      return {
        expense: rows[0],
        counter: counterSummary,
      };
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

      const counter = await getCounterContext(client, expense.cash_management_id, params.salonId);
      if (counter.status !== "open") {
        throw new AppError(400, "Cannot update expense on a closed counter", "COUNTER_CLOSED");
      }

      if (
        params.body.expense_type === undefined &&
        params.body.description === undefined &&
        params.body.amount === undefined &&
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

      const counterSummary = await recalculateCounterById(client, expense.cash_management_id, params.salonId);

      await client.query("COMMIT");
      return {
        expense: rows[0],
        counter: counterSummary,
      };
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

      const counter = await getCounterContext(client, expense.cash_management_id, params.salonId);
      if (counter.status !== "open") {
        throw new AppError(400, "Cannot delete expense from a closed counter", "COUNTER_CLOSED");
      }

      await client.query(`DELETE FROM cash_management_expenses WHERE id = $1`, [params.expenseId]);
      const counterSummary = await recalculateCounterById(client, expense.cash_management_id, params.salonId);

      await client.query("COMMIT");
      return {
        deleted: true,
        cash_management_id: expense.cash_management_id,
        counter: counterSummary,
      };
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
          "Cash counter is already closed",
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

      await client.query("COMMIT");
      return rows[0];
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },
};
