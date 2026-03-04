import pool from "../../config/database";
import {
  AddOnGroup,
  AddOnGroupDetail,
  AddOnOption,
  Bundle,
  BundleDetail,
  BundleListResponse,
  BundleServiceItem,
  CreateAddOnGroupBody,
  CreateAddOnOptionBody,
  CreateBundleBody,
  CreateServiceBody,
  ListBundlesQuery,
  ListServicesQuery,
  Service,
  ServiceDetail,
  ServiceListResponse,
  ServiceStaff,
  UpdateAddOnGroupBody,
  UpdateAddOnOptionBody,
  UpdateBundleBody,
  UpdateServiceBody,
} from "./services.types";

// ─── Query builders ───────────────────────────────────────────────────────────

const buildServiceWhere = (q: ListServicesQuery) => {
  const where: string[] = [];
  const values: unknown[] = [];

  const add = (sql: string, val: unknown) => {
    values.push(val);
    where.push(sql.replace("?", `$${values.length}`));
  };

  if (q.category_id) add(`s.category_id = ?`, q.category_id);
  if (q.search) add(`LOWER(s.name) LIKE LOWER(?)`, `%${q.search}%`);
  if (q.status === "active") where.push(`s.is_active = true`);
  if (q.status === "inactive") where.push(`s.is_active = false`);
  if (q.online_booking && q.online_booking !== "all")
    where.push(`s.online_booking = ${q.online_booking === "enabled" ? "true" : "false"}`);
  if (q.commissions && q.commissions !== "all")
    where.push(`s.commission_enabled = ${q.commissions === "enabled" ? "true" : "false"}`);
  if (q.resource_requirements && q.resource_requirements !== "all")
    where.push(`s.resource_required = ${q.resource_requirements === "required" ? "true" : "false"}`);
  if (q.staff_id)
    add(`EXISTS (SELECT 1 FROM service_staff ss WHERE ss.service_id = s.id AND ss.staff_id = ?)`, q.staff_id);

  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", values };
};

const buildBundleWhere = (q: ListBundlesQuery) => {
  const where: string[] = [];
  const values: unknown[] = [];

  const add = (sql: string, val: unknown) => {
    values.push(val);
    where.push(sql.replace("?", `$${values.length}`));
  };

  if (q.category_id) add(`b.category_id = ?`, q.category_id);
  if (q.search) add(`LOWER(b.name) LIKE LOWER(?)`, `%${q.search}%`);
  if (q.status === "active") where.push(`b.is_active = true`);
  if (q.status === "inactive") where.push(`b.is_active = false`);
  if (q.online_booking && q.online_booking !== "all")
    where.push(`b.online_booking = ${q.online_booking === "enabled" ? "true" : "false"}`);
  if (q.commissions && q.commissions !== "all")
    where.push(`b.commission_enabled = ${q.commissions === "enabled" ? "true" : "false"}`);
  if (q.resource_requirements && q.resource_requirements !== "all")
    where.push(`b.resource_required = ${q.resource_requirements === "required" ? "true" : "false"}`);
  if (q.available_for && q.available_for !== "all")
    add(`b.available_for = ?`, q.available_for);
  if (q.team_member_id)
    add(
      `EXISTS (
        SELECT 1 FROM bundle_services bs2
        JOIN service_staff ss ON ss.service_id = bs2.service_id
        WHERE bs2.bundle_id = b.id AND ss.staff_id = ?
      )`,
      q.team_member_id
    );

  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", values };
};

// ─── Services ─────────────────────────────────────────────────────────────────

export const servicesRepository = {
  async findById(id: string): Promise<Service | null> {
    const { rows } = await pool.query(
      `SELECT s.*, s.duration_minutes AS duration, c.name AS category_name
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       WHERE s.id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async list(query: ListServicesQuery): Promise<ServiceListResponse> {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 20)));
    const offset = (page - 1) * limit;
    const { whereSql, values } = buildServiceWhere(query);

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM services s ${whereSql}`,
      values
    );
    const total: number = countRes.rows[0]?.total ?? 0;

    const dataRes = await pool.query(
      `SELECT s.*, s.duration_minutes AS duration, c.name AS category_name
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       ${whereSql}
       ORDER BY s.created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    return {
      data: dataRes.rows,
      pagination: { total, page, limit, total_pages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  async listAll(query: ListServicesQuery): Promise<Service[]> {
    const { whereSql, values } = buildServiceWhere(query);
    const { rows } = await pool.query(
      `SELECT s.*, s.duration_minutes AS duration, c.name AS category_name
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       ${whereSql}
       ORDER BY s.created_at DESC`,
      values
    );
    return rows;
  },

  async create(data: CreateServiceBody): Promise<Service> {
    const { rows } = await pool.query(
      `INSERT INTO services (
        name, category_id, treatment_type, description,
        price_type, price, duration_minutes,
        online_booking, commission_enabled, resource_required
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *, duration_minutes AS duration`,
      [
        data.name,
        data.category_id,
        data.treatment_type ?? null,
        data.description ?? null,
        data.price_type ?? "fixed",
        data.price ?? 0,
        data.duration ?? 60,
        data.online_booking ?? true,
        data.commission_enabled ?? false,
        data.resource_required ?? false,
      ]
    );
    return rows[0];
  },

  async update(id: string, patch: UpdateServiceBody): Promise<Service> {
    const normalized: Record<string, unknown> = { ...patch };
    if (normalized.duration !== undefined) {
      normalized.duration_minutes = normalized.duration;
      delete normalized.duration;
    }
    delete normalized.staff_ids;
    delete normalized.team_member_ids;

    const keys = Object.keys(normalized);
    if (!keys.length) {
      const { rows } = await pool.query(
        `SELECT s.*, s.duration_minutes AS duration, c.name AS category_name
         FROM services s
         LEFT JOIN service_categories c ON c.id = s.category_id
         WHERE s.id = $1`,
        [id]
      );
      return rows[0];
    }

    const setParts = keys.map((k, i) => `${k} = $${i + 1}`);
    const values: unknown[] = keys.map((k) => normalized[k]);
    setParts.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE services SET ${setParts.join(", ")}
       WHERE id = $${values.length}
       RETURNING *, duration_minutes AS duration`,
      values
    );
    return rows[0];
  },

  async delete(id: string): Promise<void> {
    await pool.query(`DELETE FROM services WHERE id = $1`, [id]);
  },

  async replaceStaff(serviceId: string, staffIds: string[]): Promise<void> {
    await pool.query(`DELETE FROM service_staff WHERE service_id = $1`, [serviceId]);
    if (!staffIds.length) return;
    const values: unknown[] = [];
    const rowsSql: string[] = [];
    staffIds.forEach((sId, i) => {
      values.push(serviceId, sId);
      rowsSql.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
    });
    await pool.query(
      `INSERT INTO service_staff (service_id, staff_id) VALUES ${rowsSql.join(", ")}`,
      values
    );
  },

  async getStaff(serviceId: string): Promise<ServiceStaff[]> {
    const { rows } = await pool.query(
      `SELECT st.id AS staff_id, CONCAT(st.first_name, ' ', st.last_name) AS name
       FROM service_staff ss
       JOIN staff st ON st.id = ss.staff_id
       WHERE ss.service_id = $1
       ORDER BY st.first_name ASC`,
      [serviceId]
    );
    return rows;
  },

  async listAddOnGroupsWithOptions(serviceId: string): Promise<AddOnGroupDetail[]> {
    const groupsRes = await pool.query(
      `SELECT * FROM service_add_on_groups WHERE service_id = $1 ORDER BY created_at ASC`,
      [serviceId]
    );
    const groups: AddOnGroup[] = groupsRes.rows;
    if (!groups.length) return [];

    const optRes = await pool.query(
      `SELECT * FROM service_add_on_options
       WHERE add_on_group_id = ANY($1::uuid[])
       ORDER BY created_at ASC`,
      [groups.map((g) => g.id)]
    );

    const byGroup: Record<string, AddOnOption[]> = {};
    for (const o of optRes.rows as AddOnOption[]) {
      byGroup[o.add_on_group_id] = byGroup[o.add_on_group_id] || [];
      byGroup[o.add_on_group_id].push(o);
    }
    return groups.map((g) => ({ ...g, options: byGroup[g.id] || [] }));
  },

  async createAddOnGroup(serviceId: string, data: CreateAddOnGroupBody): Promise<AddOnGroup> {
    const { rows } = await pool.query(
      `INSERT INTO service_add_on_groups
        (service_id, name, prompt_to_client, min_quantity, max_quantity, allow_multiple_same)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        serviceId,
        data.name,
        data.prompt_to_client ?? "Select an option",
        data.min_quantity ?? null,
        data.max_quantity ?? null,
        data.allow_multiple_same ?? false,
      ]
    );
    return rows[0];
  },

  async updateAddOnGroup(groupId: string, patch: UpdateAddOnGroupBody): Promise<AddOnGroup> {
    const keys = Object.keys(patch) as (keyof UpdateAddOnGroupBody)[];
    if (!keys.length) {
      const { rows } = await pool.query(`SELECT * FROM service_add_on_groups WHERE id = $1`, [groupId]);
      return rows[0];
    }
    const setParts = keys.map((k, i) => `${k} = $${i + 1}`);
    const values: unknown[] = keys.map((k) => patch[k]);
    setParts.push(`updated_at = NOW()`);
    values.push(groupId);
    const { rows } = await pool.query(
      `UPDATE service_add_on_groups SET ${setParts.join(", ")}
       WHERE id = $${values.length} RETURNING *`,
      values
    );
    return rows[0];
  },

  async deleteAddOnGroup(groupId: string): Promise<void> {
    await pool.query(`DELETE FROM service_add_on_groups WHERE id = $1`, [groupId]);
  },

  async createAddOnOption(groupId: string, data: CreateAddOnOptionBody): Promise<AddOnOption> {
    const { rows } = await pool.query(
      `INSERT INTO service_add_on_options
        (add_on_group_id, name, description, additional_price, additional_duration)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [groupId, data.name, data.description ?? null, data.additional_price ?? 0, data.additional_duration ?? 0]
    );
    return rows[0];
  },

  async updateAddOnOption(optionId: string, patch: UpdateAddOnOptionBody): Promise<AddOnOption> {
    const keys = Object.keys(patch) as (keyof UpdateAddOnOptionBody)[];
    if (!keys.length) {
      const { rows } = await pool.query(`SELECT * FROM service_add_on_options WHERE id = $1`, [optionId]);
      return rows[0];
    }
    const setParts = keys.map((k, i) => `${k} = $${i + 1}`);
    const values: unknown[] = keys.map((k) => patch[k]);
    setParts.push(`updated_at = NOW()`);
    values.push(optionId);
    const { rows } = await pool.query(
      `UPDATE service_add_on_options SET ${setParts.join(", ")}
       WHERE id = $${values.length} RETURNING *`,
      values
    );
    return rows[0];
  },

  async deleteAddOnOption(optionId: string): Promise<void> {
    await pool.query(`DELETE FROM service_add_on_options WHERE id = $1`, [optionId]);
  },

  async getDetailById(serviceId: string): Promise<ServiceDetail | null> {
    const svc = await this.findById(serviceId);
    if (!svc) return null;
    const [staff, add_on_groups] = await Promise.all([
      this.getStaff(serviceId),
      this.listAddOnGroupsWithOptions(serviceId),
    ]);
    return { ...svc, staff, add_on_groups };
  },
};

// ─── Bundles ──────────────────────────────────────────────────────────────────

export const bundlesRepository = {
  async findById(id: string): Promise<Bundle | null> {
    const { rows } = await pool.query(
      `SELECT b.*, c.name AS category_name
       FROM bundles b
       LEFT JOIN service_categories c ON c.id = b.category_id
       WHERE b.id = $1`,
      [id]
    );
    return rows[0] || null;
  },

  async list(query: ListBundlesQuery): Promise<BundleListResponse> {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 20)));
    const offset = (page - 1) * limit;
    const { whereSql, values } = buildBundleWhere(query);

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM bundles b ${whereSql}`,
      values
    );
    const total: number = countRes.rows[0]?.total ?? 0;

    const dataRes = await pool.query(
      `SELECT b.*, c.name AS category_name
       FROM bundles b
       LEFT JOIN service_categories c ON c.id = b.category_id
       ${whereSql}
       ORDER BY b.created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    return {
      data: dataRes.rows,
      pagination: { total, page, limit, total_pages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  async listAll(query: ListBundlesQuery): Promise<Bundle[]> {
    const { whereSql, values } = buildBundleWhere(query);
    const { rows } = await pool.query(
      `SELECT b.*, c.name AS category_name
       FROM bundles b
       LEFT JOIN service_categories c ON c.id = b.category_id
       ${whereSql}
       ORDER BY b.created_at DESC`,
      values
    );
    return rows;
  },

  async create(data: CreateBundleBody): Promise<Bundle> {
    const { rows } = await pool.query(
      `INSERT INTO bundles (
        name, category_id, description,
        schedule_type, price_type, retail_price,
        online_booking, commission_enabled, resource_required, available_for
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        data.name,
        data.category_id,
        data.description ?? null,
        data.schedule_type ?? "sequence",
        data.price_type ?? "service_pricing",
        data.retail_price ?? 0,
        data.online_booking ?? true,
        data.commission_enabled ?? false,
        data.resource_required ?? false,
        data.available_for ?? "all",
      ]
    );
    return rows[0];
  },

  async update(id: string, patch: UpdateBundleBody): Promise<Bundle> {
    const normalized: Record<string, unknown> = { ...patch };
    delete normalized.service_ids;

    const keys = Object.keys(normalized);
    if (!keys.length) {
      const { rows } = await pool.query(
        `SELECT b.*, c.name AS category_name
         FROM bundles b
         LEFT JOIN service_categories c ON c.id = b.category_id
         WHERE b.id = $1`,
        [id]
      );
      return rows[0];
    }

    const setParts = keys.map((k, i) => `${k} = $${i + 1}`);
    const values: unknown[] = keys.map((k) => normalized[k]);
    setParts.push(`updated_at = NOW()`);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE bundles SET ${setParts.join(", ")}
       WHERE id = $${values.length} RETURNING *`,
      values
    );
    return rows[0];
  },

  async delete(id: string): Promise<void> {
    await pool.query(`DELETE FROM bundles WHERE id = $1`, [id]);
  },

  async replaceServices(bundleId: string, serviceIds: string[]): Promise<void> {
    await pool.query(`DELETE FROM bundle_services WHERE bundle_id = $1`, [bundleId]);
    if (!serviceIds.length) return;
    const values: unknown[] = [];
    const rowsSql: string[] = [];
    serviceIds.forEach((sId, i) => {
      values.push(bundleId, sId, i + 1);
      rowsSql.push(`($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`);
    });
    await pool.query(
      `INSERT INTO bundle_services (bundle_id, service_id, sort_order) VALUES ${rowsSql.join(", ")}`,
      values
    );
  },

  async getBundleServices(bundleId: string): Promise<BundleServiceItem[]> {
    const { rows } = await pool.query(
      `SELECT s.id AS service_id, s.name, s.price, s.duration_minutes AS duration,
              s.price_type, bs.sort_order
       FROM bundle_services bs
       JOIN services s ON s.id = bs.service_id
       WHERE bs.bundle_id = $1
       ORDER BY bs.sort_order ASC`,
      [bundleId]
    );
    return rows;
  },

  async getDetailById(bundleId: string): Promise<BundleDetail | null> {
    const bundle = await this.findById(bundleId);
    if (!bundle) return null;
    const services = await this.getBundleServices(bundleId);
    return { ...bundle, services };
  },
};