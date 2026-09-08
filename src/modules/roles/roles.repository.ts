import pool from "../../config/database";
import { Permission, Role } from "./roles.types";

export const rolesRepository = {
    // ── Global permission catalog ───────────────────────────────────────────
    async listPermissions(): Promise<Permission[]> {
        const { rows } = await pool.query(
            `SELECT * FROM permissions ORDER BY module, group_name NULLS FIRST, action`
        );
        return rows;
    },

    async permissionKeysExist(keys: string[]): Promise<string[]> {
        if (keys.length === 0) return [];
        const { rows } = await pool.query(
            `SELECT key FROM permissions WHERE key = ANY($1::text[])`,
            [keys]
        );
        return rows.map((r) => r.key);
    },

    // ── Roles ────────────────────────────────────────────────────────────────
    async listRoles(salonId: string): Promise<(Role & { staff_count: number })[]> {
        const { rows } = await pool.query(
            `SELECT r.*, COUNT(s.id)::int AS staff_count
             FROM roles r
             LEFT JOIN staff s ON s.role_id = r.id
             WHERE r.salon_id = $1
             GROUP BY r.id
             ORDER BY r.created_at`,
            [salonId]
        );
        return rows;
    },

    async findRoleById(id: string, salonId: string): Promise<(Role & { staff_count: number }) | null> {
        const { rows } = await pool.query(
            `SELECT r.*, COUNT(s.id)::int AS staff_count
             FROM roles r
             LEFT JOIN staff s ON s.role_id = r.id
             WHERE r.id = $1 AND r.salon_id = $2
             GROUP BY r.id`,
            [id, salonId]
        );
        return rows[0] || null;
    },

    async findRoleByName(salonId: string, name: string): Promise<Role | null> {
        const { rows } = await pool.query(
            `SELECT * FROM roles WHERE salon_id = $1 AND name = $2`,
            [salonId, name]
        );
        return rows[0] || null;
    },

    async createRole(salonId: string, name: string, description: string | null): Promise<Role> {
        const { rows } = await pool.query(
            `INSERT INTO roles (salon_id, name, description) VALUES ($1, $2, $3) RETURNING *`,
            [salonId, name, description]
        );
        return rows[0];
    },

    async updateRole(id: string, salonId: string, patch: { name?: string; description?: string }): Promise<Role | null> {
        const sets: string[] = [];
        const values: unknown[] = [];
        let idx = 1;
        if (patch.name !== undefined) { sets.push(`name = $${idx}`); values.push(patch.name); idx++; }
        if (patch.description !== undefined) { sets.push(`description = $${idx}`); values.push(patch.description); idx++; }
        if (sets.length === 0) return this.findByIdPlain(id, salonId);
        sets.push(`updated_at = NOW()`);
        values.push(id, salonId);
        const { rows } = await pool.query(
            `UPDATE roles SET ${sets.join(", ")} WHERE id = $${idx} AND salon_id = $${idx + 1} RETURNING *`,
            values
        );
        return rows[0] || null;
    },

    async findByIdPlain(id: string, salonId: string): Promise<Role | null> {
        const { rows } = await pool.query(`SELECT * FROM roles WHERE id = $1 AND salon_id = $2`, [id, salonId]);
        return rows[0] || null;
    },

    async deleteRole(id: string, salonId: string): Promise<boolean> {
        const { rowCount } = await pool.query(`DELETE FROM roles WHERE id = $1 AND salon_id = $2`, [id, salonId]);
        return (rowCount ?? 0) > 0;
    },

    async countStaffForRole(roleId: string): Promise<number> {
        const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM staff WHERE role_id = $1`, [roleId]);
        return rows[0]?.count ?? 0;
    },

    async reassignStaffRole(fromRoleId: string, toRoleId: string): Promise<void> {
        await pool.query(`UPDATE staff SET role_id = $1 WHERE role_id = $2`, [toRoleId, fromRoleId]);
    },

    // ── Role permissions ─────────────────────────────────────────────────────
    async getRolePermissions(roleId: string): Promise<Record<string, boolean>> {
        const { rows } = await pool.query(
            `SELECT permission_key, allowed FROM role_permissions WHERE role_id = $1`,
            [roleId]
        );
        const result: Record<string, boolean> = {};
        for (const row of rows) result[row.permission_key] = row.allowed;
        return result;
    },

    /** Upserts one (role_id, permission_key) → allowed row. */
    async setRolePermission(roleId: string, key: string, allowed: boolean): Promise<void> {
        await pool.query(
            `INSERT INTO role_permissions (role_id, permission_key, allowed)
             VALUES ($1, $2, $3)
             ON CONFLICT (role_id, permission_key) DO UPDATE SET allowed = EXCLUDED.allowed`,
            [roleId, key, allowed]
        );
    },

    async deleteRolePermissions(roleId: string): Promise<void> {
        await pool.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);
    },

    // ── Staff role assignment + overrides ────────────────────────────────────
    async getStaffRoleId(staffId: string, salonId: string): Promise<{ id: string; role_id: string | null } | null> {
        const { rows } = await pool.query(
            `SELECT id, role_id FROM staff WHERE id = $1 AND salon_id = $2`,
            [staffId, salonId]
        );
        return rows[0] || null;
    },

    async assignStaffRole(staffId: string, roleId: string): Promise<void> {
        await pool.query(`UPDATE staff SET role_id = $1 WHERE id = $2`, [roleId, staffId]);
    },

    async getStaffOverrides(staffId: string): Promise<Record<string, boolean>> {
        const { rows } = await pool.query(
            `SELECT permission_key, allowed FROM staff_permission_overrides WHERE staff_id = $1`,
            [staffId]
        );
        const result: Record<string, boolean> = {};
        for (const row of rows) result[row.permission_key] = row.allowed;
        return result;
    },

    /** null `allowed` clears the override for that key (deletes the row). */
    async setStaffOverride(staffId: string, key: string, allowed: boolean | null, setBy: string | null): Promise<void> {
        if (allowed === null) {
            await pool.query(
                `DELETE FROM staff_permission_overrides WHERE staff_id = $1 AND permission_key = $2`,
                [staffId, key]
            );
            return;
        }
        await pool.query(
            `INSERT INTO staff_permission_overrides (staff_id, permission_key, allowed, set_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (staff_id, permission_key) DO UPDATE SET allowed = EXCLUDED.allowed, set_by = EXCLUDED.set_by, updated_at = NOW()`,
            [staffId, key, allowed, setBy]
        );
    },

    async deleteAllStaffOverrides(staffId: string): Promise<void> {
        await pool.query(`DELETE FROM staff_permission_overrides WHERE staff_id = $1`, [staffId]);
    },

    // ── Audit log ─────────────────────────────────────────────────────────────
    async insertAuditLog(entry: {
        salonId: string;
        actorUserId: string;
        targetType: "staff" | "role";
        targetId: string;
        action: string;
        permissionKey?: string | null;
        beforeValue?: unknown;
        afterValue?: unknown;
        source: "role_default" | "individual_override" | "role_edit" | "role_assignment";
        ipAddress?: string | null;
        userAgent?: string | null;
    }): Promise<void> {
        await pool.query(
            `INSERT INTO permission_audit_log (
                salon_id, actor_user_id, target_type, target_id, action, permission_key,
                before_value, after_value, source, ip_address, user_agent
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
                entry.salonId,
                entry.actorUserId,
                entry.targetType,
                entry.targetId,
                entry.action,
                entry.permissionKey ?? null,
                entry.beforeValue !== undefined ? JSON.stringify(entry.beforeValue) : null,
                entry.afterValue !== undefined ? JSON.stringify(entry.afterValue) : null,
                entry.source,
                entry.ipAddress ?? null,
                entry.userAgent ?? null,
            ]
        );
    },
};
