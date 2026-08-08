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
  CreateConsultationFormBody,
  CreateServiceBody,
  ListBundlesQuery,
  ListServicesQuery,
  Service,
  ServiceConsultationForm,
  ServiceDetail,
  ServiceListResponse,
  ServiceStaff,
  UpdateAddOnGroupBody,
  UpdateAddOnOptionBody,
  UpdateBundleBody,
  UpdateConsultationFormBody,
  UpdateServiceBody,
} from "./services.types";

// Correlated subquery, spliced into every services SELECT below — returns
// each service's configured consumable recipe as a JSON array so callers
// never need a second round-trip to fetch it (services.repository.ts is the
// only place this fragment should live; don't copy it elsewhere).
const CONSUMABLES_USED_SUBQUERY = `
  COALESCE(
    (SELECT json_agg(json_build_object(
        'product_id', sc.product_id,
        'product_name', p.name,
        'qty', sc.qty,
        'unit', sc.unit,
        -- Current on-hand stock in BASE units, carried on the recipe itself.
        -- Without it the Consumable Usage panel had to look the product up in
        -- the frontend's shared products cache, which is paged and partial —
        -- so a consumable that simply wasn't in that page showed "—" and
        -- "Stock Unknown" however carefully its stock had been set up. This
        -- subquery already joins products, so it costs nothing extra.
        'stock', COALESCE(p.amount, 0),
        'bottle_size', p.bottle_size,
        'measure_unit', p.measure_unit
      ) ORDER BY sc.sort_order)
     FROM service_consumables sc
     JOIN products p ON p.id = sc.product_id
     WHERE sc.service_id = s.id),
    '[]'::json
  ) AS consumables_used
`;

// ─── Query builders ───────────────────────────────────────────────────────────

const buildServiceWhere = (q: ListServicesQuery, salonId: string) => {
  const where: string[] = [];
  const values: unknown[] = [];

  // Always scope to salon first
  values.push(salonId);
  where.push(`s.salon_id = $${values.length}`);

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

const buildBundleWhere = (q: ListBundlesQuery, salonId: string) => {
  const where: string[] = [];
  const values: unknown[] = [];

  // Always scope to salon first
  values.push(salonId);
  where.push(`b.salon_id = $${values.length}`);

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
  if (q.available_for && q.available_for !== "all") add(`b.available_for = ?`, q.available_for);
  if (q.team_member_id)
    add(
      `EXISTS (SELECT 1 FROM bundle_services bs2 JOIN service_staff ss ON ss.service_id = bs2.service_id WHERE bs2.bundle_id = b.id AND ss.staff_id = ?)`,
      q.team_member_id
    );

  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", values };
};

// ─── Services ─────────────────────────────────────────────────────────────────

export const servicesRepository = {
  async findById(id: string, salonId: string): Promise<Service | null> {
    const { rows } = await pool.query(
      `SELECT s.*, s.duration_minutes AS duration, c.name AS category_name, ${CONSUMABLES_USED_SUBQUERY}
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       WHERE s.id = $1 AND s.salon_id = $2`,
      [id, salonId]
    );
    return rows[0] || null;
  },

  async list(query: ListServicesQuery, salonId: string): Promise<ServiceListResponse> {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 20)));
    const offset = (page - 1) * limit;
    const { whereSql, values } = buildServiceWhere(query, salonId);

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM services s ${whereSql}`,
      values
    );
    const total: number = countRes.rows[0]?.total ?? 0;

    const dataRes = await pool.query(
      `SELECT s.*, s.duration_minutes AS duration, c.name AS category_name, ${CONSUMABLES_USED_SUBQUERY}
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

  async listAll(query: ListServicesQuery, salonId: string): Promise<Service[]> {
    const { whereSql, values } = buildServiceWhere(query, salonId);
    const { rows } = await pool.query(
      `SELECT s.*, s.duration_minutes AS duration, c.name AS category_name, ${CONSUMABLES_USED_SUBQUERY}
       FROM services s
       LEFT JOIN service_categories c ON c.id = s.category_id
       ${whereSql}
       ORDER BY s.created_at DESC`,
      values
    );
    return rows;
  },

  async create(data: CreateServiceBody, salonId: string): Promise<Service> {
    const { rows } = await pool.query(
      `INSERT INTO services (
        salon_id, name, category_id, treatment_type, description,
        price_type, price, duration_minutes,
        online_booking, commission_enabled, resource_required
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *, duration_minutes AS duration`,
      [
        salonId,
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

  async update(id: string, patch: UpdateServiceBody, salonId: string): Promise<Service> {
    // Only these columns actually exist in the services table.
    // Any extra fields sent by the client (all_members, padding_before,
    // discounted_price, image_url, etc.) are silently ignored so a dynamic
    // SET clause never references non-existent columns.
    const ALLOWED: ReadonlySet<string> = new Set([
      "name", "category_id", "treatment_type", "description",
      "price_type", "price", "duration_minutes", "is_active",
      "online_booking", "commission_enabled", "resource_required",
    ]);

    const raw = patch as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};

    // duration → duration_minutes
    if (raw.duration !== undefined) normalized.duration_minutes = raw.duration;

    // Copy only whitelisted columns (skips staff_ids, team_member_ids,
    // all_members, padding_before, padding_after, image_url, etc.)
    for (const key of ALLOWED) {
      if (key !== "duration_minutes" && raw[key] !== undefined) {
        normalized[key] = raw[key];
      }
    }

    const keys = Object.keys(normalized);
    if (!keys.length) {
      const { rows } = await pool.query(
        `SELECT s.*, s.duration_minutes AS duration, c.name AS category_name
         FROM services s
         LEFT JOIN service_categories c ON c.id = s.category_id
         WHERE s.id = $1 AND s.salon_id = $2`,
        [id, salonId]
      );
      return rows[0];
    }

    const setParts = keys.map((k, i) => `${k} = $${i + 1}`);
    const values: unknown[] = keys.map((k) => normalized[k]);
    setParts.push(`updated_at = NOW()`);
    values.push(id);
    values.push(salonId);

    const { rows } = await pool.query(
      `UPDATE services SET ${setParts.join(", ")}
       WHERE id = $${values.length - 1} AND salon_id = $${values.length}
       RETURNING *, duration_minutes AS duration`,
      values
    );
    return rows[0];
  },

  async delete(id: string, salonId: string): Promise<void> {
    await pool.query(`DELETE FROM services WHERE id = $1 AND salon_id = $2`, [id, salonId]);
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

  async replaceConsumables(serviceId: string, items: { product_id: string; qty: number; unit?: string }[]): Promise<void> {
    await pool.query(`DELETE FROM service_consumables WHERE service_id = $1`, [serviceId]);
    if (!items.length) return;
    const values: unknown[] = [];
    const rowsSql: string[] = [];
    items.forEach((item, i) => {
      values.push(serviceId, item.product_id, item.qty, item.unit ?? null, i);
      const base = i * 5;
      rowsSql.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
    });
    await pool.query(
      `INSERT INTO service_consumables (service_id, product_id, qty, unit, sort_order) VALUES ${rowsSql.join(", ")}`,
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
      `SELECT * FROM service_add_on_options WHERE add_on_group_id = ANY($1::uuid[]) ORDER BY created_at ASC`,
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
      [serviceId, data.name, data.prompt_to_client ?? "Select an option", data.min_quantity ?? null, data.max_quantity ?? null, data.allow_multiple_same ?? false]
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
      `UPDATE service_add_on_groups SET ${setParts.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values
    );
    return rows[0];
  },

  async deleteAddOnGroup(groupId: string): Promise<void> {
    await pool.query(`DELETE FROM service_add_on_groups WHERE id = $1`, [groupId]);
  },

  async createAddOnOption(groupId: string, data: CreateAddOnOptionBody): Promise<AddOnOption> {
    const { rows } = await pool.query(
      `INSERT INTO service_add_on_options (add_on_group_id, name, description, additional_price, additional_duration)
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
      `UPDATE service_add_on_options SET ${setParts.join(", ")} WHERE id = $${values.length} RETURNING *`,
      values
    );
    return rows[0];
  },

  async deleteAddOnOption(optionId: string): Promise<void> {
    await pool.query(`DELETE FROM service_add_on_options WHERE id = $1`, [optionId]);
  },

  async listConsultationForms(serviceId: string): Promise<ServiceConsultationForm[]> {
    const { rows } = await pool.query(
      `SELECT id, service_id, name, is_selected, field_values AS values, created_at, updated_at
       FROM service_consultation_forms
       WHERE service_id = $1
       ORDER BY created_at ASC`,
      [serviceId]
    );
    return rows;
  },

  async createConsultationForm(serviceId: string, data: CreateConsultationFormBody): Promise<ServiceConsultationForm> {
    const { rows } = await pool.query(
      `INSERT INTO service_consultation_forms (service_id, name)
       VALUES ($1,$2)
       RETURNING id, service_id, name, is_selected, field_values AS values, created_at, updated_at`,
      [serviceId, data.name]
    );
    return rows[0];
  },

  async updateConsultationForm(formId: string, patch: UpdateConsultationFormBody): Promise<ServiceConsultationForm> {
    // Map camelCase-ish request keys to actual column names (values → field_values).
    const COLUMN: Record<string, string> = { name: "name", is_selected: "is_selected", values: "field_values" };
    const keys = (Object.keys(patch) as (keyof UpdateConsultationFormBody)[]).filter((k) => k in COLUMN);

    if (!keys.length) {
      const { rows } = await pool.query(
        `SELECT id, service_id, name, is_selected, field_values AS values, created_at, updated_at
         FROM service_consultation_forms WHERE id = $1`,
        [formId]
      );
      return rows[0];
    }

    const setParts = keys.map((k, i) => `${COLUMN[k]} = $${i + 1}`);
    const values: unknown[] = keys.map((k) =>
      k === "values" ? JSON.stringify(patch[k] ?? null) : patch[k],
    );
    setParts.push(`updated_at = NOW()`);
    values.push(formId);

    const { rows } = await pool.query(
      `UPDATE service_consultation_forms SET ${setParts.join(", ")}
       WHERE id = $${values.length}
       RETURNING id, service_id, name, is_selected, field_values AS values, created_at, updated_at`,
      values
    );
    return rows[0];
  },

  async deleteConsultationForm(formId: string): Promise<void> {
    await pool.query(`DELETE FROM service_consultation_forms WHERE id = $1`, [formId]);
  },

  async getDetailById(serviceId: string, salonId: string): Promise<ServiceDetail | null> {
    const svc = await this.findById(serviceId, salonId);
    if (!svc) return null;

    let staff: ServiceStaff[] = [];
    let add_on_groups: AddOnGroupDetail[] = [];
    let consultation_forms: ServiceConsultationForm[] = [];
    try {
      [staff, add_on_groups, consultation_forms] = await Promise.all([
        this.getStaff(serviceId),
        this.listAddOnGroupsWithOptions(serviceId),
        this.listConsultationForms(serviceId),
      ]);
    } catch {
      // Secondary tables may not exist yet; return base service data
    }

    return { ...svc, staff, add_on_groups, consultation_forms };
  },
};

// ─── Bundles ──────────────────────────────────────────────────────────────────

export const bundlesRepository = {
  async findById(id: string, salonId: string): Promise<Bundle | null> {
    const { rows } = await pool.query(
      `SELECT b.*, c.name AS category_name
       FROM bundles b
       LEFT JOIN service_categories c ON c.id = b.category_id
       WHERE b.id = $1 AND b.salon_id = $2`,
      [id, salonId]
    );
    return rows[0] || null;
  },

  async list(query: ListBundlesQuery, salonId: string): Promise<BundleListResponse> {
    const page = Math.max(1, Number(query.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 20)));
    const offset = (page - 1) * limit;
    const { whereSql, values } = buildBundleWhere(query, salonId);

    const countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM bundles b ${whereSql}`, values);
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

  async listAll(query: ListBundlesQuery, salonId: string): Promise<Bundle[]> {
    const { whereSql, values } = buildBundleWhere(query, salonId);
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

  async create(data: CreateBundleBody, salonId: string): Promise<Bundle> {
    const { rows } = await pool.query(
      `INSERT INTO bundles (
        salon_id, name, category_id, description,
        schedule_type, price_type, retail_price,
        online_booking, commission_enabled, resource_required, available_for
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        salonId,
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

  async update(id: string, patch: UpdateBundleBody, salonId: string): Promise<Bundle> {
    const normalized: Record<string, unknown> = { ...patch };
    delete normalized.service_ids;

    const keys = Object.keys(normalized);
    if (!keys.length) {
      const { rows } = await pool.query(
        `SELECT b.*, c.name AS category_name FROM bundles b LEFT JOIN service_categories c ON c.id = b.category_id WHERE b.id = $1 AND b.salon_id = $2`,
        [id, salonId]
      );
      return rows[0];
    }

    const setParts = keys.map((k, i) => `${k} = $${i + 1}`);
    const values: unknown[] = keys.map((k) => normalized[k]);
    setParts.push(`updated_at = NOW()`);
    values.push(id);
    values.push(salonId);

    const { rows } = await pool.query(
      `UPDATE bundles SET ${setParts.join(", ")} WHERE id = $${values.length - 1} AND salon_id = $${values.length} RETURNING *`,
      values
    );
    return rows[0];
  },

  async delete(id: string, salonId: string): Promise<void> {
    await pool.query(`DELETE FROM bundles WHERE id = $1 AND salon_id = $2`, [id, salonId]);
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

  async getDetailById(bundleId: string, salonId: string): Promise<BundleDetail | null> {
    const bundle = await this.findById(bundleId, salonId);
    if (!bundle) return null;
    const services = await this.getBundleServices(bundleId);
    return { ...bundle, services };
  },
};