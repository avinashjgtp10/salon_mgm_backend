/**
 * One-time data migration for the Roles & Permissions redesign (Phase 1).
 *
 * Run AFTER Migration/create_permissions_system_tables.sql has been applied
 * by hand. Per project policy this script is NOT run automatically by
 * anything — invoke it manually against each environment (dev, then QA,
 * then prod) once you're ready, in that order.
 *
 * What it does, per salon:
 *   1. Reads the existing salon_settings row (key='role_permissions'), if any.
 *   2. Creates (or reuses, if re-run) a "Staff" and a "Manager" role for the
 *      salon, populating role_permissions from that blob's staff/manager
 *      values — or from the DEFAULT_STAFF_PERMS/manager-default snapshot
 *      below if the salon never had a role_permissions setting.
 *   3. For every staff row with role_id still NULL: sets role_id to the new
 *      Staff role.
 *   4. For every staff row with a non-null custom_permissions blob: diffs
 *      the blob's EFFECTIVE value per key (customPerms[key] ?? false,
 *      matching permission.middleware.ts's current resolution) against the
 *      new Staff role's default for that key, and inserts a
 *      staff_permission_overrides row ONLY where they differ. This is the
 *      deliberate fix for the current bug where the old blob always held
 *      every key — after this migration, a staff member is only "custom"
 *      on the keys an owner actually changed.
 *
 * Idempotent: re-running is safe. Roles are looked up by (salon_id, name)
 * before creating; staff already carrying a role_id are left alone; override
 * rows use ON CONFLICT (staff_id, permission_key) DO NOTHING.
 *
 * Usage:
 *   npx ts-node scripts/backfill-permissions-system.ts --dry-run   # preview only, no writes
 *   npx ts-node scripts/backfill-permissions-system.ts             # actually apply
 */

import pool from '../src/config/database';

// Snapshot of permission.middleware.ts's DEFAULT_STAFF_PERMS at the time
// this script was written. If that map has changed since, reconcile before
// re-running against a salon that would fall back to it (i.e. one with no
// salon_settings role_permissions row).
const DEFAULT_STAFF_PERMS: Record<string, boolean> = {
  view_campaigns: false,
  create_campaigns: false,
  design_coupons: false,
  view_calendar: true,
  manage_calendar: false,
  view_clients: true,
  create_clients: true,
  edit_clients: true,
  delete_clients: false,
  view_sales: true,
  create_sales: true,
  view_services: true,
  create_services: false,
  edit_services: false,
  view_products: true,
  create_products: false,
  view_packages: true,
  create_packages: false,
  view_memberships: true,
  create_memberships: false,
  view_inventory: true,
  manage_inventory: false,
  stock_adjustment: false,
  view_booking: true,
  manage_booking: false,
  view_team: true,
  add_team_member: false,
  edit_team_member: false,
  manage_shifts: false,
  view_payroll: false,
  view_reports: false,
  export_reports: false,
  general_settings: false,
  manage_pos_payments: false,
  view_enquiries: true,
};

// permissionMatrix.ts hardcodes `manager: true` on every current entry —
// this preserves that as the Manager role's starting point (adjustable
// afterward through the normal Role Editor once it exists).
const DEFAULT_MANAGER_VALUE = true;

// Full key list — must match Migration/create_permissions_system_tables.sql's
// seed exactly, since role_permissions.permission_key has an FK to permissions.key.
const ALL_KEYS = [
  'view_dashboard',
  'view_sales', 'create_sales',
  'view_calendar', 'manage_calendar',
  'view_clients', 'create_clients', 'edit_clients', 'delete_clients',
  'view_services', 'create_services', 'edit_services',
  'view_memberships', 'create_memberships',
  'view_products', 'create_products',
  'view_packages', 'create_packages',
  'view_inventory', 'manage_inventory', 'stock_adjustment',
  'view_booking', 'manage_booking',
  'view_campaigns', 'create_campaigns', 'design_coupons',
  'view_enquiries',
  'view_team', 'add_team_member', 'edit_team_member', 'manage_shifts', 'view_payroll',
  'view_reports', 'export_reports',
  'general_settings', 'permission_settings', 'manage_pos_payments',
  'access_help_center',
];

type RolePermMap = Record<string, { owner: boolean; staff: boolean; manager?: boolean }>;

interface Summary {
  salonsProcessed: number;
  rolesCreated: number;
  staffAssigned: number;
  overridesCreated: number;
}

async function migrateSalon(
  salonId: string,
  dryRun: boolean,
  summary: Summary
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Load this salon's existing role_permissions blob, if any.
    const { rows: settingRows } = await client.query(
      `SELECT value FROM salon_settings WHERE salon_id = $1 AND key = 'role_permissions' LIMIT 1`,
      [salonId]
    );
    let blob: RolePermMap = {};
    if (settingRows[0]?.value) {
      try {
        blob = JSON.parse(settingRows[0].value);
      } catch {
        console.warn(`  ⚠️  salon ${salonId}: malformed role_permissions JSON, treating as empty`);
      }
    }

    const staffDefault = (key: string) => blob[key]?.staff ?? DEFAULT_STAFF_PERMS[key] ?? false;
    const managerDefault = (key: string) => blob[key]?.manager ?? DEFAULT_MANAGER_VALUE;

    // 2. Ensure Staff + Manager roles exist for this salon.
    const roleIds: Record<'Staff' | 'Manager', string> = { Staff: '', Manager: '' };
    for (const roleName of ['Staff', 'Manager'] as const) {
      const { rows: existing } = await client.query(
        `SELECT id FROM roles WHERE salon_id = $1 AND name = $2`,
        [salonId, roleName]
      );
      if (existing[0]) {
        roleIds[roleName] = existing[0].id;
        continue;
      }
      if (dryRun) {
        console.log(`  [dry-run] would create role "${roleName}" for salon ${salonId}`);
        roleIds[roleName] = `dry-run-${roleName}`;
        continue;
      }
      const { rows: created } = await client.query(
        `INSERT INTO roles (salon_id, name, description, is_default)
         VALUES ($1, $2, $3, TRUE) RETURNING id`,
        [
          salonId,
          roleName,
          roleName === 'Staff'
            ? 'Default role for staff members, migrated from prior salon defaults.'
            : 'Default role for managers, migrated from prior salon defaults.',
        ]
      );
      roleIds[roleName] = created[0].id;
      summary.rolesCreated++;

      // Populate role_permissions for every catalog key.
      const valuesForKey = roleName === 'Staff' ? staffDefault : managerDefault;
      for (const key of ALL_KEYS) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_key, allowed)
           VALUES ($1, $2, $3)
           ON CONFLICT (role_id, permission_key) DO NOTHING`,
          [roleIds[roleName], key, valuesForKey(key)]
        );
      }
    }

    // 3 & 4. Per-staff role assignment + sparse override backfill.
    const { rows: staffRows } = await client.query(
      `SELECT id, user_id, custom_permissions, role_id FROM staff WHERE salon_id = $1`,
      [salonId]
    );
    for (const staff of staffRows) {
      if (staff.role_id) continue; // already migrated — idempotent skip

      if (!dryRun) {
        await client.query(`UPDATE staff SET role_id = $1 WHERE id = $2`, [roleIds.Staff, staff.id]);
      }
      summary.staffAssigned++;

      const customPerms: Record<string, boolean> | null = staff.custom_permissions;
      if (customPerms == null) continue; // no overrides to migrate for this staff member

      for (const key of ALL_KEYS) {
        const oldEffective = customPerms[key] ?? false; // matches current staffHasPermission() behavior
        const newRoleDefault = staffDefault(key);
        if (oldEffective === newRoleDefault) continue; // no override needed — falls through to role default correctly

        if (dryRun) {
          console.log(
            `  [dry-run] staff ${staff.id}: override ${key} = ${oldEffective} (role default is ${newRoleDefault})`
          );
        } else {
          await client.query(
            `INSERT INTO staff_permission_overrides (staff_id, permission_key, allowed, set_by)
             VALUES ($1, $2, $3, NULL)
             ON CONFLICT (staff_id, permission_key) DO NOTHING`,
            [staff.id, key, oldEffective]
          );
        }
        summary.overridesCreated++;
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  ❌ salon ${salonId} failed, rolled back:`, err);
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(dryRun ? '🔍 DRY RUN — no data will be written\n' : '✍️  LIVE RUN — writing data\n');

  const { rows: salons } = await pool.query('SELECT id FROM salons');
  const summary: Summary = { salonsProcessed: 0, rolesCreated: 0, staffAssigned: 0, overridesCreated: 0 };

  for (const salon of salons) {
    console.log(`Processing salon ${salon.id}...`);
    await migrateSalon(salon.id, dryRun, summary);
    summary.salonsProcessed++;
  }

  console.log('\n── Summary ──────────────────────────────');
  console.log(`Salons processed:   ${summary.salonsProcessed}`);
  console.log(`Roles created:      ${summary.rolesCreated}`);
  console.log(`Staff assigned:     ${summary.staffAssigned}`);
  console.log(`Overrides created:  ${summary.overridesCreated}`);
  if (dryRun) console.log('\n(dry run — nothing was actually written; re-run without --dry-run to apply)');

  await pool.end();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
