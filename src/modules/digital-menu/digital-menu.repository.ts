import crypto from "crypto";
import pool from "../../config/database";
import { DigitalMenu, DigitalMenuServiceMode, DigitalMenuStatus } from "./digital-menu.types";

// Idempotent boot-time bootstrap — mirrors client-notes.repository.ts /
// client-memberships.repository.ts. One menu per salon; selected services are
// a real mapping table (not a JSON array column) so a deleted service is
// automatically dropped from every menu via ON DELETE CASCADE, matching the
// bundle_services / service_staff pattern used elsewhere in this schema.
export async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS digital_menus (
      id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      salon_id                UUID        NOT NULL UNIQUE,
      name                    VARCHAR(255) NOT NULL DEFAULT 'Main Menu',
      status                  VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      service_selection_mode  VARCHAR(20) NOT NULL DEFAULT 'all_active' CHECK (service_selection_mode IN ('all_active', 'specific')),
      public_token            VARCHAR(64) NOT NULL UNIQUE,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_digital_menus_token ON digital_menus(public_token)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS digital_menu_services (
      menu_id    UUID NOT NULL REFERENCES digital_menus(id) ON DELETE CASCADE,
      service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      PRIMARY KEY (menu_id, service_id)
    )
  `);
}

function generatePublicToken(): string {
  // Same shape as staff-invitation tokens elsewhere in this codebase.
  return crypto.randomBytes(32).toString("hex");
}

export const digitalMenuRepository = {
  async findBySalonId(salonId: string): Promise<DigitalMenu | null> {
    const { rows } = await pool.query(`SELECT * FROM digital_menus WHERE salon_id = $1`, [salonId]);
    return rows[0] || null;
  },

  async findById(id: string, salonId: string): Promise<DigitalMenu | null> {
    const { rows } = await pool.query(
      `SELECT * FROM digital_menus WHERE id = $1 AND salon_id = $2`,
      [id, salonId],
    );
    return rows[0] || null;
  },

  async findByPublicToken(token: string): Promise<DigitalMenu | null> {
    const { rows } = await pool.query(`SELECT * FROM digital_menus WHERE public_token = $1`, [token]);
    return rows[0] || null;
  },

  async create(params: {
    salonId: string;
    name: string;
    status: DigitalMenuStatus;
    serviceSelectionMode: DigitalMenuServiceMode;
  }): Promise<DigitalMenu> {
    const { rows } = await pool.query(
      `INSERT INTO digital_menus (salon_id, name, status, service_selection_mode, public_token)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [params.salonId, params.name, params.status, params.serviceSelectionMode, generatePublicToken()],
    );
    return rows[0];
  },

  async update(params: {
    id: string;
    salonId: string;
    name: string;
    status: DigitalMenuStatus;
    serviceSelectionMode: DigitalMenuServiceMode;
  }): Promise<DigitalMenu | null> {
    const { rows } = await pool.query(
      `UPDATE digital_menus
       SET name = $3, status = $4, service_selection_mode = $5, updated_at = NOW()
       WHERE id = $1 AND salon_id = $2
       RETURNING *`,
      [params.id, params.salonId, params.name, params.status, params.serviceSelectionMode],
    );
    return rows[0] || null;
  },

  async replaceSelectedServices(menuId: string, serviceIds: string[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM digital_menu_services WHERE menu_id = $1`, [menuId]);
      if (serviceIds.length > 0) {
        const values = serviceIds.map((_, i) => `($1, $${i + 2})`).join(", ");
        await client.query(
          `INSERT INTO digital_menu_services (menu_id, service_id) VALUES ${values}
           ON CONFLICT DO NOTHING`,
          [menuId, ...serviceIds],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  async findSelectedServiceIds(menuId: string): Promise<string[]> {
    const { rows } = await pool.query(
      `SELECT service_id FROM digital_menu_services WHERE menu_id = $1`,
      [menuId],
    );
    return rows.map((r) => r.service_id);
  },

  // Counts reflect only services that are STILL active — a service made
  // inactive or deleted after being selected silently drops out of both
  // counts and the public listing, with no cleanup step required (deletion
  // also cascades the mapping row away via ON DELETE CASCADE above).
  async countForMenu(salonId: string, mode: DigitalMenuServiceMode, menuId: string): Promise<{ service_count: number; category_count: number }> {
    const { rows } = await mode === "all_active"
      ? await pool.query(
          `SELECT COUNT(DISTINCT s.id)::int AS service_count,
                  COUNT(DISTINCT s.category_id)::int AS category_count
           FROM services s
           WHERE s.salon_id = $1 AND s.is_active = true`,
          [salonId],
        )
      : await pool.query(
          `SELECT COUNT(DISTINCT s.id)::int AS service_count,
                  COUNT(DISTINCT s.category_id)::int AS category_count
           FROM services s
           JOIN digital_menu_services dms ON dms.service_id = s.id
           WHERE dms.menu_id = $1 AND s.salon_id = $2 AND s.is_active = true`,
          [menuId, salonId],
        );
    return rows[0] ?? { service_count: 0, category_count: 0 };
  },

  // Public read: only active services, grouped by category, scoped to the
  // menu's own salon (defense in depth — service_id already implies salon_id
  // via the FK, but this keeps the query self-contained and cheap to reason
  // about if the mapping table is ever reused elsewhere).
  async findPublicServices(salonId: string, mode: DigitalMenuServiceMode, menuId: string) {
    const { rows } = mode === "all_active"
      ? await pool.query(
          `SELECT s.id, s.name, s.description, s.price, s.price_type,
                  s.duration_minutes AS duration, s.online_booking,
                  COALESCE(c.name, 'Other Services') AS category_name
           FROM services s
           LEFT JOIN service_categories c ON c.id = s.category_id
           WHERE s.salon_id = $1 AND s.is_active = true
           ORDER BY category_name, s.name`,
          [salonId],
        )
      : await pool.query(
          `SELECT s.id, s.name, s.description, s.price, s.price_type,
                  s.duration_minutes AS duration, s.online_booking,
                  COALESCE(c.name, 'Other Services') AS category_name
           FROM services s
           JOIN digital_menu_services dms ON dms.service_id = s.id
           LEFT JOIN service_categories c ON c.id = s.category_id
           WHERE dms.menu_id = $1 AND s.salon_id = $2 AND s.is_active = true
           ORDER BY category_name, s.name`,
          [menuId, salonId],
        );
    return rows;
  },
};
