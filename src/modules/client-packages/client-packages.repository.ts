import pool from "../../config/database";
import { v4 as uuidv4 } from "uuid";
import type {
  ClientPackage,
  ClientPackageRow,
  CreateClientPackageDTO,
  CompleteSessionDTO,
  ClientPackagesListQuery,
} from "./client-packages.types";

// ── Row → Domain mapper ───────────────────────────────────────────────────────

function toClientPackage(row: ClientPackageRow): ClientPackage {
  const base     = parseFloat(row.base_price);
  const gstPct   = parseFloat(row.gst_percentage);
  const gstAmt   = parseFloat(row.gst_amount);
  const discount = parseFloat(row.discount);
  const total    = parseFloat(row.total_amount);
  const paid     = parseFloat(row.paid_amount);
  const pending  = parseFloat(row.pending_amount);

  return {
    id:            row.id,
    salonId:       row.salon_id,
    clientId:      row.client_id,
    clientName:    row.client_name,
    mobile:        row.mobile  ?? undefined,
    email:         row.email   ?? undefined,
    packageName:   row.package_name,
    category:      row.category,
    branch:        row.branch,
    createdDate:   new Date(row.created_date).toISOString(),
    expiryDate:    row.expiry_date,
    status:        row.status,
    basePrice:     base,
    gstPercentage: gstPct,
    gstAmount:     gstAmt,
    discount:      discount,
    totalAmount:   total,
    paymentMethod: row.payment_method,
    paidAmount:    paid,
    pendingAmount: pending,
    paymentStatus: row.payment_status,
    services: (row.services ?? []).map(s => ({
      serviceId:         s.service_id,
      serviceName:       s.service_name,
      totalSessions:     s.total_sessions,
      completedSessions: s.completed_sessions,
      remainingSessions: s.total_sessions - s.completed_sessions,
      price:             s.price != null ? parseFloat(s.price) : 0,
      // session history is keyed by service id in row.session_history_map
      sessionHistory: ((row as any).session_history_map?.[s.service_id] ?? []).map((h: any) => ({
        sessionNo: h.session_no,
        date:      new Date(h.session_date).toLocaleDateString("en-IN", {
          day: "2-digit", month: "short", year: "numeric",
        }),
        staff:  h.staff_name,
        status: h.status,
      })),
    })),
  };
}

// ── Shared SELECT (with session history) ─────────────────────────────────────
// We fetch session history as a JSON array keyed by service id in a subquery

const SELECT_FULL = `
  SELECT
    cp.*,
    COALESCE(
      json_agg(
        json_build_object(
          'service_id',         cps.id,
          'service_name',       cps.service_name,
          'total_sessions',     cps.total_sessions,
          'completed_sessions', cps.completed_sessions,
          'price',              cps.price
        )
      ) FILTER (WHERE cps.id IS NOT NULL),
      '[]'
    ) AS services,
    (
      SELECT COALESCE(
        json_object_agg(
          svc_id::text,
          svc_history
        ),
        '{}'
      )
      FROM (
        SELECT
          cps2.id AS svc_id,
          COALESCE(
            json_agg(
              json_build_object(
                'session_no',   h.session_no,
                'session_date', h.session_date,
                'staff_name',   h.staff_name,
                'status',       h.status
              ) ORDER BY h.session_no ASC
            ) FILTER (WHERE h.id IS NOT NULL),
            '[]'
          ) AS svc_history
        FROM client_package_services cps2
        LEFT JOIN client_package_session_history h
          ON h.client_package_service_id = cps2.id
        WHERE cps2.client_package_id = cp.id
        GROUP BY cps2.id
      ) sub
    ) AS session_history_map
  FROM client_packages cp
  LEFT JOIN client_package_services cps ON cps.client_package_id = cp.id
`;

// ── Repository ────────────────────────────────────────────────────────────────

export const clientPackagesRepository = {

  async list(
    salonId: string,
    query: ClientPackagesListQuery,
  ): Promise<{ items: ClientPackage[]; total: number }> {
    const conditions: string[] = ["cp.salon_id = $1"];
    const values: any[]        = [salonId];
    let idx = 2;

    if (query.clientId) {
      conditions.push(`cp.client_id = $${idx++}`);
      values.push(query.clientId);
    }
    if (query.search) {
      conditions.push(`(cp.package_name ILIKE $${idx} OR cp.client_name ILIKE $${idx})`);
      values.push(`%${query.search}%`);
      idx++;
    }
    if (query.status) {
      conditions.push(`cp.status = $${idx++}`);
      values.push(query.status);
    }

    const where  = `WHERE ${conditions.join(" AND ")}`;
    const page   = Math.max(1, query.page  ?? 1);
    const limit  = Math.min(100, query.limit ?? 20);
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `${SELECT_FULL} ${where} GROUP BY cp.id ORDER BY cp.created_date DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) FROM client_packages cp ${where}`,
      values,
    );

    return {
      items: rows.map(toClientPackage),
      total: parseInt(countRes.rows[0].count, 10),
    };
  },

  async findById(id: string, salonId: string): Promise<ClientPackage | null> {
    const { rows } = await pool.query(
      `${SELECT_FULL} WHERE cp.id = $1 AND cp.salon_id = $2 GROUP BY cp.id`,
      [id, salonId],
    );
    return rows.length ? toClientPackage(rows[0]) : null;
  },

  async create(salonId: string, dto: CreateClientPackageDTO): Promise<ClientPackage> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const clientRes = await client.query(
        `SELECT first_name, last_name, phone_number, email FROM clients WHERE id = $1 AND salon_id = $2`,
        [dto.clientId, salonId],
      );
      if (!clientRes.rows.length) throw new Error("Client not found");

      const c           = clientRes.rows[0];
      const clientName  = `${c.first_name} ${c.last_name ?? ""}`.trim();
      const gstAmount   = parseFloat(((dto.basePrice - dto.discount) * dto.gstPercentage / 100).toFixed(2));
      const totalAmount = parseFloat((dto.basePrice - dto.discount + gstAmount).toFixed(2));
      const pkgId       = uuidv4();

      await client.query(
        `INSERT INTO client_packages
          (id, salon_id, client_id, client_name, mobile, email,
           package_name, category, branch, expiry_date,
           base_price, gst_percentage, gst_amount, discount, total_amount,
           payment_method, paid_amount, pending_amount, payment_status, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          pkgId, salonId, dto.clientId, clientName,
          c.phone_number ?? null, c.email ?? null,
          dto.packageName, dto.category, dto.branch, dto.expiryDate,
          dto.basePrice, dto.gstPercentage, gstAmount, dto.discount, totalAmount,
          dto.paymentMethod,
          totalAmount,  // paid_amount = full amount on creation
          0,            // pending_amount
          "Paid",
          "Active",
        ],
      );

      for (const svc of dto.services) {
        await client.query(
          `INSERT INTO client_package_services
            (id, client_package_id, service_name, total_sessions, completed_sessions, price)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [uuidv4(), pkgId, svc.serviceName, svc.totalSessions, 0, svc.price],
        );
      }

      const { rows } = await client.query(
        `${SELECT_FULL} WHERE cp.id = $1 GROUP BY cp.id`,
        [pkgId],
      );

      await client.query("COMMIT");
      return toClientPackage(rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async completeSession(
    packageId: string,
    salonId:   string,
    dto:       CompleteSessionDTO,
  ): Promise<ClientPackage | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const svcRes = await client.query(
        `SELECT cps.id, cps.total_sessions, cps.completed_sessions
         FROM client_package_services cps
         JOIN client_packages cp ON cp.id = cps.client_package_id
         WHERE cps.id = $1 AND cp.id = $2 AND cp.salon_id = $3`,
        [dto.serviceId, packageId, salonId],
      );

      if (!svcRes.rows.length) throw new Error("Service not found in this package");

      const svc = svcRes.rows[0];
      if (svc.completed_sessions >= svc.total_sessions) {
        throw new Error("All sessions already completed for this service");
      }

      const newCompleted = svc.completed_sessions + 1;

      await client.query(
        `UPDATE client_package_services SET completed_sessions = $1 WHERE id = $2`,
        [newCompleted, svc.id],
      );

      await client.query(
        `INSERT INTO client_package_session_history
          (id, client_package_id, client_package_service_id, session_no, staff_name, status)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [uuidv4(), packageId, svc.id, newCompleted, dto.staffName, "Completed"],
      );

      // If all services fully done → mark package Completed
      const remaining = await client.query(
        `SELECT COUNT(*) FROM client_package_services
         WHERE client_package_id = $1 AND completed_sessions < total_sessions`,
        [packageId],
      );
      if (parseInt(remaining.rows[0].count, 10) === 0) {
        await client.query(
          `UPDATE client_packages SET status = 'Completed' WHERE id = $1`,
          [packageId],
        );
      }

      const { rows } = await client.query(
        `${SELECT_FULL} WHERE cp.id = $1 GROUP BY cp.id`,
        [packageId],
      );

      await client.query("COMMIT");
      return rows.length ? toClientPackage(rows[0]) : null;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },
};