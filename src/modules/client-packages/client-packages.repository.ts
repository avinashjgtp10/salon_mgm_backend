import pool from "../../config/database";
import { v4 as uuidv4 } from "uuid";
import type {
  ClientPackage,
  ClientPackageRow,
  CreateClientPackageDTO,
  UpdateClientPackageDTO,
  CompleteSessionDTO,
  ClientPackagesListQuery,
} from "./client-packages.types";

// ── Row → Domain mapper ───────────────────────────────────────────────────────

// `status` is only ever explicitly written as 'Active' (at creation) or
// 'Completed' (all sessions consumed — see completeSession() below) —
// nothing in this module transitions it to 'Expired' when expiry_date
// passes, so a package purchased last year with the same day/month expiry
// as today stays "Active" in the database forever (same DD-MM, different
// year — the actual bug: every consumer that trusted this column straight
// through, from Quick Sale/Calendar's package picker to the client's
// "active package" count, ended up only ever noticing the day/month
// matched, never that the year hadn't). Computed once here, at the source,
// rather than patched into every frontend call site — the next consumer
// that reads `status` directly would otherwise reintroduce the same bug.
function effectiveStatus(status: string, expiryDate: string | null): string {
  if (status === "Active" && expiryDate && new Date(expiryDate).getTime() < Date.now()) {
    return "Expired";
  }
  return status;
}

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
    expireAfterServices: row.expire_after_services ?? null,
    description:   row.description ?? null,
    status:        effectiveStatus(row.status, row.expiry_date),
    basePrice:     base,
    gstPercentage: gstPct,
    gstAmount:     gstAmt,
    discount:      discount,
    totalAmount:   total,
    paymentMethod: row.payment_method,
    splitDetails:  row.split_details ?? null,
    paidAmount:    paid,
    pendingAmount: pending,
    paymentStatus: row.payment_status,
    appointmentId: row.appointment_id ?? null,
    staffId:       row.staff_id ?? null,
    saleId:        row.sale_id ?? null,
    services: (row.services ?? []).map(s => ({
      serviceId:         s.service_id,
      catalogServiceId:  s.catalog_service_id ?? null,
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
      // schedule slots are keyed by service id in row.schedule_map
      scheduleSlots: (row.schedule_map?.[s.service_id] ?? []).map(sc => ({
        id:            sc.id,
        appointmentId: sc.appointment_id,
        staffId:       sc.staff_id ?? null,
        staffName:     sc.staff_name ?? null,
        status:        sc.status as any,
        scheduledAt:   sc.scheduled_at ? new Date(sc.scheduled_at).toISOString() : null,
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
          'catalog_service_id', cps.catalog_service_id,
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
    ) AS session_history_map,
    (
      SELECT COALESCE(
        json_object_agg(
          svc_id::text,
          svc_schedules
        ),
        '{}'
      )
      FROM (
        SELECT
          cps3.id AS svc_id,
          COALESCE(
            json_agg(
              json_build_object(
                'id',             sch.id,
                'appointment_id', sch.appointment_id,
                'staff_id',       sch.staff_id,
                'staff_name',     NULLIF(TRIM(CONCAT(st.first_name, ' ', COALESCE(st.last_name, ''))), ''),
                'status',         sch.status,
                'scheduled_at',   sch.scheduled_at
              ) ORDER BY sch.scheduled_at ASC NULLS LAST
            ) FILTER (WHERE sch.id IS NOT NULL),
            '[]'
          ) AS svc_schedules
        FROM client_package_services cps3
        LEFT JOIN client_package_service_schedules sch
          ON sch.client_package_service_id = cps3.id
        LEFT JOIN staff st ON st.id = sch.staff_id
        WHERE cps3.client_package_id = cp.id
        GROUP BY cps3.id
      ) sub2
    ) AS schedule_map
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
      const paidSoFar   = parseFloat(
        (totalAmount * Math.min(1, Math.max(0, dto.paidFraction ?? 1))).toFixed(2),
      );

      await client.query(
        `INSERT INTO client_packages
          (id, salon_id, client_id, client_name, mobile, email,
           package_name, category, branch, expiry_date,
           base_price, gst_percentage, gst_amount, discount, total_amount,
           payment_method, split_details, paid_amount, pending_amount, payment_status, status, appointment_id, staff_id, expire_after_services, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
        [
          pkgId, salonId, dto.clientId, clientName,
          c.phone_number ?? null, c.email ?? null,
          dto.packageName, dto.category ?? "", dto.branch ?? "", dto.expiryDate ?? "2099-12-31",
          dto.basePrice, dto.gstPercentage, gstAmount, dto.discount, totalAmount,
          dto.paymentMethod,
          dto.splitDetails ? JSON.stringify(dto.splitDetails) : null,
          // Defaults to the full amount (every paid-in-full caller), but a
          // package credited off a still-partially-paid bill records what has
          // actually been received so the Package Sale report and receipts
          // don't show money that hasn't arrived. Clamped to 0..total so a
          // malformed fraction can't over- or negatively-credit the row.
          paidSoFar,
          parseFloat((totalAmount - paidSoFar).toFixed(2)),
          dto.paymentStatus ?? "Paid",
          "Active",
          dto.appointmentId ?? null,
          dto.staffId ?? null,
          dto.expireAfterServices ?? null,
          dto.description ?? null,
        ],
      );

      // Capture the generated ids in dto.services order — the SELECT_FULL
      // below re-fetches services via json_agg with no ORDER BY guarantee,
      // so relying on its output order to zip back against dto.services[i]
      // (needed by the caller to match a `schedule` to the right created
      // service) would be unreliable. Reordered below instead.
      const serviceIds: string[] = [];
      for (const svc of dto.services) {
        const svcId = uuidv4();
        serviceIds.push(svcId);
        await client.query(
          `INSERT INTO client_package_services
            (id, client_package_id, service_name, catalog_service_id, total_sessions, completed_sessions, price)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [svcId, pkgId, svc.serviceName, svc.serviceId ?? null, svc.totalSessions, 0, svc.price],
        );
      }

      const { rows } = await client.query(
        `${SELECT_FULL} WHERE cp.id = $1 GROUP BY cp.id`,
        [pkgId],
      );

      await client.query("COMMIT");

      const pkg = toClientPackage(rows[0]);
      const byId = new Map(pkg.services.map(s => [s.serviceId, s]));
      pkg.services = serviceIds.map(id => byId.get(id)).filter((s): s is typeof pkg.services[number] => !!s);
      return pkg;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  // Links a client_packages row to the sales row recordTransaction() created
  // for it — called right after create(), once the sale id is known, so the
  // Package Sale report can look up invoice_no via a join.
  async setSaleId(id: string, salonId: string, saleId: string): Promise<void> {
    await pool.query(
      `UPDATE client_packages SET sale_id = $1 WHERE id = $2 AND salon_id = $3`,
      [saleId, id, salonId],
    );
  },

  // The real cash/card/upi/split method the client actually paid with, for
  // a package auto-created as a line item on a bill (see autoCreateFromPayment
  // in the service) — that flow has no payment method of its own to record at
  // creation time, only the sale this package was bundled into.
  async getSalePaymentMethod(saleId: string, salonId: string): Promise<string | null> {
    const { rows } = await pool.query(
      `SELECT payment_method FROM sales WHERE id = $1 AND salon_id = $2`,
      [saleId, salonId],
    );
    return rows[0]?.payment_method ?? null;
  },

  async update(
    id:      string,
    salonId: string,
    dto:     UpdateClientPackageDTO,
  ): Promise<ClientPackage | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const updates: string[] = [];
      const values:  any[]    = [];
      let idx = 1;

      if (dto.packageName   !== undefined) { updates.push(`package_name = $${idx++}`);    values.push(dto.packageName); }
      if (dto.expiryDate    !== undefined) { updates.push(`expiry_date = $${idx++}`);      values.push(dto.expiryDate); }
      if (dto.paymentMethod !== undefined) { updates.push(`payment_method = $${idx++}`);  values.push(dto.paymentMethod); }

      if (dto.basePrice !== undefined || dto.gstPercentage !== undefined || dto.discount !== undefined) {
        const cur = await client.query(
          `SELECT base_price, gst_percentage, discount FROM client_packages WHERE id = $1 AND salon_id = $2`,
          [id, salonId],
        );
        if (!cur.rows.length) throw new Error("Package not found");
        const row    = cur.rows[0];
        const base   = dto.basePrice     ?? parseFloat(row.base_price);
        const gstPct = dto.gstPercentage ?? parseFloat(row.gst_percentage);
        const disc   = dto.discount      ?? parseFloat(row.discount);
        const gstAmt = parseFloat(((base - disc) * gstPct / 100).toFixed(2));
        const total  = parseFloat((base - disc + gstAmt).toFixed(2));

        updates.push(`base_price = $${idx++}`);     values.push(base);
        updates.push(`gst_percentage = $${idx++}`); values.push(gstPct);
        updates.push(`gst_amount = $${idx++}`);     values.push(gstAmt);
        updates.push(`discount = $${idx++}`);       values.push(disc);
        updates.push(`total_amount = $${idx++}`);   values.push(total);
        updates.push(`paid_amount = $${idx++}`);    values.push(total);
        updates.push(`pending_amount = $${idx++}`); values.push(0);
      }

      if (updates.length > 0) {
        values.push(id, salonId);
        await client.query(
          `UPDATE client_packages SET ${updates.join(", ")} WHERE id = $${idx++} AND salon_id = $${idx++}`,
          values,
        );
      }

      if (dto.services?.length) {
        for (const svc of dto.services) {
          const su: string[] = [];
          const sv: any[]    = [];
          let si = 1;
          if (svc.serviceName    !== undefined) { su.push(`service_name = $${si++}`);    sv.push(svc.serviceName); }
          if (svc.totalSessions  !== undefined) { su.push(`total_sessions = $${si++}`);  sv.push(svc.totalSessions); }
          if (svc.price          !== undefined) { su.push(`price = $${si++}`);           sv.push(svc.price); }
          if (su.length > 0) {
            sv.push(svc.serviceId);
            await client.query(
              `UPDATE client_package_services SET ${su.join(", ")} WHERE id = $${si++}`,
              sv,
            );
          }
        }
      }

      const { rows } = await client.query(
        `${SELECT_FULL} WHERE cp.id = $1 AND cp.salon_id = $2 GROUP BY cp.id`,
        [id, salonId],
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

  async delete(id: string, salonId: string): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Verify ownership
      const check = await client.query(
        `SELECT id FROM client_packages WHERE id = $1 AND salon_id = $2`,
        [id, salonId],
      );
      if (!check.rows.length) return false;

      // Delete session history, then services, then the package (child rows first)
      await client.query(
        `DELETE FROM client_package_session_history
         WHERE client_package_service_id IN (
           SELECT id FROM client_package_services WHERE client_package_id = $1
         )`,
        [id],
      );
      await client.query(
        `DELETE FROM client_package_services WHERE client_package_id = $1`,
        [id],
      );
      await client.query(
        `DELETE FROM client_packages WHERE id = $1 AND salon_id = $2`,
        [id, salonId],
      );

      await client.query("COMMIT");
      return true;
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

      // Lock the package row FIRST. Quick Sale/Calendar checkout fires one
      // completeSession call per covered service CONCURRENTLY (see
      // markPackageSessions in AppointmentModal.tsx — Promise.allSettled, not
      // a sequential loop), so without this lock, several calls for the same
      // package could each read a stale "not yet Completed" snapshot and all
      // succeed even after the aggregate cap below was already reached by
      // one of them. FOR UPDATE serializes them — each waits for the
      // previous one's COMMIT, so the status/cap check every call performs
      // is always against up-to-date state.
      const pkgRes = await client.query(
        `SELECT status, expire_after_services, expiry_date FROM client_packages
         WHERE id = $1 AND salon_id = $2 FOR UPDATE`,
        [packageId, salonId],
      );
      if (!pkgRes.rows.length) throw new Error("Client package not found");
      if (pkgRes.rows[0].status === "Completed") {
        throw new Error("This package has already been fully used.");
      }
      // status alone doesn't catch this — it's only ever written 'Active' (at
      // creation) or 'Completed' (all sessions consumed), never flipped to
      // 'Expired' when expiry_date passes (see toClientPackage()'s identical
      // fix for the read side). Without this, Quick Sale/Calendar could still
      // redeem a session from a package whose expiry was the same day/month
      // as today but a past year, since only 'Completed' was ever rejected.
      if (pkgRes.rows[0].expiry_date && new Date(pkgRes.rows[0].expiry_date).getTime() < Date.now()) {
        throw new Error("This package has expired and can no longer be used.");
      }
      const cap = pkgRes.rows[0].expire_after_services;

      const svcRes = await client.query(
        `SELECT id, total_sessions, completed_sessions
         FROM client_package_services
         WHERE id = $1 AND client_package_id = $2`,
        [dto.serviceId, packageId],
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
          (id, client_package_id, client_package_service_id, session_no, staff_name, status, appointment_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uuidv4(), packageId, svc.id, newCompleted, dto.staffName, "Completed", dto.appointmentId ?? null],
      );

      // If all services fully done → mark package Completed
      const remaining = await client.query(
        `SELECT COUNT(*) FROM client_package_services
         WHERE client_package_id = $1 AND completed_sessions < total_sessions`,
        [packageId],
      );
      let allServicesDone = parseInt(remaining.rows[0].count, 10) === 0;

      // Aggregate-session cap ("Expires after this many services", see
      // package_templates.expire_after_services): once this package's TOTAL
      // completed sessions across ALL its services combined reach the cap it
      // was sold with, it closes early — even if individual services still
      // have sessions left unused.
      if (!allServicesDone && cap != null) {
        const totalRes = await client.query(
          `SELECT COALESCE(SUM(completed_sessions), 0) AS total
           FROM client_package_services WHERE client_package_id = $1`,
          [packageId],
        );
        if (parseInt(totalRes.rows[0].total, 10) >= cap) allServicesDone = true;
      }

      if (allServicesDone) {
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

  // ── Auto-create idempotency (partial → full payment on the same bill) ─────
  // A package line item is now credited to the client as soon as the bill is
  // partially paid, which means autoCreateFromPayment runs again on the later
  // payment that settles the balance. Matching on (appointment, package name)
  // rather than appointment alone so a bill carrying two different packages
  // still creates both, while the same one can't be created twice.
  async findIdByAppointmentAndName(
    salonId: string,
    appointmentId: string,
    packageName: string,
  ): Promise<string | null> {
    const res = await pool.query(
      `SELECT id FROM client_packages
        WHERE salon_id = $1 AND appointment_id = $2 AND package_name = $3
        LIMIT 1`,
      [salonId, appointmentId, packageName],
    );
    return res.rows[0]?.id ?? null;
  },

  // Re-states how much of an already-created package has been collected, as a
  // 0..1 share of its own total_amount (which never changes here). Called on
  // every payment after the one that created the row, so a bill settled in
  // three instalments keeps this row's paid/pending accurate throughout
  // rather than only flipping at the end. fraction >= 1 settles it to Paid.
  async updatePaymentProgress(id: string, salonId: string, fraction: number): Promise<void> {
    const f = Math.min(1, Math.max(0, fraction));
    if (f >= 1) {
      await pool.query(
        `UPDATE client_packages
            SET paid_amount = total_amount, pending_amount = 0,
                payment_status = 'Paid', updated_at = NOW()
          WHERE id = $1 AND salon_id = $2`,
        [id, salonId],
      );
      return;
    }
    await pool.query(
      `UPDATE client_packages
          SET paid_amount    = ROUND(total_amount * $3, 2),
              pending_amount = ROUND(total_amount * (1 - $3), 2),
              payment_status = 'Partial', updated_at = NOW()
        WHERE id = $1 AND salon_id = $2`,
      [id, salonId, f],
    );
  },

  // ── Package-service scheduling (future appointment linkage) ────────────────

  async createServiceSchedule(params: {
    clientPackageId:        string;
    clientPackageServiceId: string;
    appointmentId:           string;
    staffId?:                string | null;
    scheduledAt:              string;
  }): Promise<string> {
    const id = uuidv4();
    await pool.query(
      `INSERT INTO client_package_service_schedules
        (id, client_package_id, client_package_service_id, appointment_id, staff_id, status, scheduled_at)
       VALUES ($1,$2,$3,$4,$5,'Scheduled',$6)`,
      [id, params.clientPackageId, params.clientPackageServiceId, params.appointmentId, params.staffId ?? null, params.scheduledAt],
    );
    return id;
  },

  async findScheduleByAppointmentId(appointmentId: string): Promise<{
    id: string;
    clientPackageId: string;
    clientPackageServiceId: string;
    status: string;
  } | null> {
    const { rows } = await pool.query(
      `SELECT id, client_package_id, client_package_service_id, status
       FROM client_package_service_schedules WHERE appointment_id = $1`,
      [appointmentId],
    );
    if (!rows.length) return null;
    return {
      id:                      rows[0].id,
      clientPackageId:         rows[0].client_package_id,
      clientPackageServiceId:  rows[0].client_package_service_id,
      status:                  rows[0].status,
    };
  },

  async updateScheduleStatusByAppointmentId(appointmentId: string, status: "Completed" | "Cancelled" | "No Show"): Promise<void> {
    await pool.query(
      `UPDATE client_package_service_schedules SET status = $1, updated_at = NOW() WHERE appointment_id = $2`,
      [status, appointmentId],
    );
  },

  // Reschedule keeps the same schedule row (same appointment_id) — only the
  // denormalized scheduled_at copy moves, per "update the existing
  // appointment, do not create a duplicate."
  async updateScheduleTimeByAppointmentId(appointmentId: string, scheduledAt: string): Promise<void> {
    await pool.query(
      `UPDATE client_package_service_schedules SET scheduled_at = $1, updated_at = NOW() WHERE appointment_id = $2`,
      [scheduledAt, appointmentId],
    );
  },
};