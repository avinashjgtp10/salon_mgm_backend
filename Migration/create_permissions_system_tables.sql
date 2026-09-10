-- Roles & Permissions system (Phase 1 — Foundation).
-- Replaces the two hand-maintained, drifted permission catalogs
-- (permissionMatrix.ts on the frontend, DEFAULT_STAFF_PERMS in
-- permission.middleware.ts) with one DB-backed catalog, and replaces the
-- single JSON blob on salon_settings(key='role_permissions') plus the
-- full-blob staff.custom_permissions column with normalized, salon-scoped
-- roles and sparse per-staff overrides.
--
-- This migration is purely additive: it does NOT touch, alter, or drop
-- staff.custom_permissions, staff.permission_level, or the salon_settings
-- role_permissions rows. Those stay live and are still what
-- permission.middleware.ts reads until the backfill script has run and the
-- resolution engine has been repointed at these new tables. See
-- scripts/backfill-permissions-system.ts for the data migration step, run
-- separately (and only) after this file has been applied.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

-- ── Global permission catalog ────────────────────────────────────────────
-- Platform-owned reference data, not salon-editable. Seeded below with the
-- reconciled union of every key currently used anywhere in either the
-- frontend matrix or the backend's DEFAULT_STAFF_PERMS fallback map,
-- including keys that are not enforced by any route today (e.g.
-- view_dashboard, view_payroll) — those stay in the catalog as-is; fixing
-- their enforcement is separate Gap Closure work, not part of this
-- migration, which only has to mirror current reality faithfully.
CREATE TABLE IF NOT EXISTS permissions (
  key           VARCHAR(60)   PRIMARY KEY,
  name          VARCHAR(100)  NOT NULL,
  description   TEXT,
  module        VARCHAR(60)   NOT NULL,
  group_name    VARCHAR(60),
  action        VARCHAR(30)   NOT NULL,
  risk_level    VARCHAR(10)   NOT NULL DEFAULT 'low'
                CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  is_system     BOOLEAN       NOT NULL DEFAULT TRUE,
  depends_on    TEXT[],
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions(module);

-- ── Salon-scoped roles ───────────────────────────────────────────────────
-- Every role (including the seeded "Staff"/"Manager" defaults created by
-- the backfill script) is an ordinary, fully-editable row scoped to one
-- salon — no protected/hardcoded tiers. Owner/Admin are NOT rows here:
-- they remain the existing users.role account types with their existing
-- unconditional bypass in permission.middleware.ts, which this migration
-- does not change.
CREATE TABLE IF NOT EXISTS roles (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id      UUID          NOT NULL REFERENCES salons(id),
  name          VARCHAR(100)  NOT NULL,
  description   TEXT,
  is_default    BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT roles_salon_name_key UNIQUE (salon_id, name)
);
CREATE INDEX IF NOT EXISTS idx_roles_salon ON roles(salon_id);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id         UUID          NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key  VARCHAR(60)   NOT NULL REFERENCES permissions(key),
  allowed         BOOLEAN       NOT NULL DEFAULT FALSE,
  PRIMARY KEY (role_id, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_key ON role_permissions(permission_key);

-- ── Per-staff overrides (sparse — replaces the full-blob custom_permissions) ─
-- Only rows that actually differ from the assigned role's default are
-- stored here. This is the deliberate fix for the current bug where the
-- first toggle in StaffPermissionsModal writes ALL ~40 keys into
-- staff.custom_permissions at once, permanently decoupling that staff
-- member from every future role-default change even on keys nobody meant
-- to touch.
CREATE TABLE IF NOT EXISTS staff_permission_overrides (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id        UUID          NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  permission_key  VARCHAR(60)   NOT NULL REFERENCES permissions(key),
  allowed         BOOLEAN       NOT NULL,
  set_by          UUID          REFERENCES users(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_permission_overrides_staff_key_key UNIQUE (staff_id, permission_key)
);
CREATE INDEX IF NOT EXISTS idx_staff_permission_overrides_staff ON staff_permission_overrides(staff_id);

-- staff.role_id — nullable for now (matches the add-column-then-backfill
-- pattern already used by add_staff_code.sql). Populated by
-- scripts/backfill-permissions-system.ts; not enforced NOT NULL here since
-- that script has to run first.
ALTER TABLE staff ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id);
CREATE INDEX IF NOT EXISTS idx_staff_role_id ON staff(role_id);

-- ── Permission change audit log ──────────────────────────────────────────
-- Mirrors the existing subscription_permission_audit_log table (already
-- proven in this codebase for the unrelated subscription-permission
-- feature) — same shape, applied here to staff/role permission changes,
-- which previously had no audit trail at all.
CREATE TABLE IF NOT EXISTS permission_audit_log (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id        UUID          NOT NULL REFERENCES salons(id),
  actor_user_id   UUID          NOT NULL REFERENCES users(id),
  target_type     VARCHAR(10)   NOT NULL CHECK (target_type IN ('staff', 'role')),
  target_id       UUID          NOT NULL,
  action          VARCHAR(30)   NOT NULL,
  permission_key  VARCHAR(60)   REFERENCES permissions(key),
  before_value    JSONB,
  after_value     JSONB,
  source          VARCHAR(30)   NOT NULL
                  CHECK (source IN ('role_default', 'individual_override', 'role_edit', 'role_assignment')),
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_permission_audit_log_salon_created ON permission_audit_log(salon_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_permission_audit_log_target ON permission_audit_log(target_type, target_id);

-- ── Seed the permission catalog ──────────────────────────────────────────
-- Reconciled union of permissionMatrix.ts (frontend, 40 keys) and
-- DEFAULT_STAFF_PERMS (backend, 35 keys). Labels/descriptions preserved
-- verbatim from permissionMatrix.ts where a key exists there. Keys that
-- exist only in the backend enforcement layer (view_sales/create_sales —
-- the ones sales.routes.ts actually checks, distinct from the frontend's
-- dead view_quick_sale/create_quick_sale toggles) are added under their
-- real names; reconciling the naming mismatch itself is Gap Closure
-- ticket #17, not part of this migration.
INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_dashboard',      'View Dashboard',        'Access the main dashboard',                          'Dashboard',     NULL,           'view',   'low',      NULL),
  -- view_quick_sale/create_quick_sale/edit_quick_sale/delete_quick_sale were
  -- removed (see Migration/remove_dead_quick_sale_permission_keys.sql) —
  -- nothing ever checked them; view_sales/create_sales below are the real
  -- keys sales.routes.ts enforces. create_sales is grouped under 'Quick
  -- Sale' (see Migration/group_create_sales_under_quick_sale_module.sql) —
  -- it's what the Quick Sale nav item and route actually gate; view_sales
  -- is grouped under 'Reports' (see
  -- Migration/group_view_sales_under_reports_module.sql) — a distinct
  -- concept (viewing past sales records/summaries/exports, not the Quick
  -- Sale screen itself) real staff pages (StaffSalesPage etc.) depend on,
  -- so it's kept, just regrouped rather than left alone in its own section.
  ('view_sales',          'View Sales',            'Access sales records and daily summaries',           'Reports',       NULL,           'view',   'low',      NULL),
  ('create_sales',        'Create Sales',          'Create, edit and checkout sales',                    'Quick Sale',    NULL,           'create', 'medium',   ARRAY['view_sales']),
  ('view_calendar',       'View Calendar',         'See all appointments on calendar',                   'Calendar',      NULL,           'view',   'low',      NULL),
  ('manage_calendar',     'Manage Calendar',       'Create, edit and cancel bookings',                   'Calendar',      NULL,           'manage', 'medium',   ARRAY['view_calendar']),
  ('view_clients',        'View Clients',          'Access client profiles',                             'Clients',       NULL,           'view',   'low',      NULL),
  ('create_clients',      'Create Clients',        'Add new client records',                             'Clients',       NULL,           'create', 'medium',   ARRAY['view_clients']),
  ('edit_clients',        'Edit Clients',          'Update client information',                          'Clients',       NULL,           'edit',   'medium',   ARRAY['view_clients']),
  ('delete_clients',      'Delete Clients',        'Remove client records',                              'Clients',       NULL,           'delete', 'high',     ARRAY['view_clients']),
  ('view_services',       'View Services',         'See all salon services',                             'Catalog',       'Services',     'view',   'low',      NULL),
  ('create_services',     'Create Services',       'Add new services',                                   'Catalog',       'Services',     'create', 'medium',   ARRAY['view_services']),
  ('edit_services',       'Edit Services',         'Modify service details and pricing',                 'Catalog',       'Services',     'edit',   'medium',   ARRAY['view_services']),
  ('view_memberships',    'View Memberships',      'See membership plans',                               'Catalog',       'Memberships',  'view',   'low',      NULL),
  ('create_memberships',  'Create Memberships',    'Add and manage membership plans',                    'Catalog',       'Memberships',  'create', 'medium',   ARRAY['view_memberships']),
  ('view_products',       'View Products',         'See products available for sale',                    'Catalog',       'Products',     'view',   'low',      NULL),
  ('create_products',     'Create Products',       'Add new products to the catalog',                    'Catalog',       'Products',     'create', 'medium',   ARRAY['view_products']),
  ('view_packages',       'View Packages',         'See service packages and bundles',                   'Catalog',       'Packages',     'view',   'low',      NULL),
  ('create_packages',     'Create Packages',       'Create and edit service packages',                   'Catalog',       'Packages',     'create', 'medium',   ARRAY['view_packages']),
  ('view_inventory',      'View Inventory',        'See current stock levels',                           'Catalog',       'Inventory',    'view',   'low',      NULL),
  ('manage_inventory',    'Manage Inventory',      'Adjust stock and reorder products',                  'Catalog',       'Inventory',    'manage', 'medium',   ARRAY['view_inventory']),
  ('stock_adjustment',    'Stock Adjustment',      'Manually adjust stock quantities',                   'Catalog',       'Inventory',    'adjust', 'high',     ARRAY['view_inventory']),
  ('view_booking',        'View Booking',          'See online booking settings',                        'Online Booking',NULL,           'view',   'low',      NULL),
  ('manage_booking',      'Manage Booking',        'Configure online booking options',                   'Online Booking',NULL,           'manage', 'medium',   ARRAY['view_booking']),
  ('view_campaigns',      'View Campaigns',        'See marketing campaigns',                            'Marketing',     NULL,           'view',   'low',      NULL),
  ('create_campaigns',    'Create Campaigns',      'Create and send campaigns',                          'Marketing',     NULL,           'create', 'medium',   ARRAY['view_campaigns']),
  ('design_coupons',      'Design Coupons',        'Create and edit coupon artwork',                     'Marketing',     NULL,           'manage', 'low',      NULL),
  ('view_enquiries',      'View Enquiries',        'See and respond to client enquiries',                'Enquiries',     NULL,           'view',   'low',      NULL),
  ('view_team',           'View Staff',            'See team members and schedules',                     'Staff',         NULL,           'view',   'low',      NULL),
  ('add_team_member',     'Add Staff Member',      'Invite and add new staff',                           'Staff',         NULL,           'create', 'medium',   ARRAY['view_team']),
  ('edit_team_member',    'Edit Staff Member',     'Update team member details',                         'Staff',         NULL,           'edit',   'high',     ARRAY['view_team']),
  ('manage_shifts',       'Manage Shifts',         'Create and edit scheduled shifts',                   'Staff',         NULL,           'manage', 'medium',   ARRAY['view_team']),
  ('view_payroll',        'View Payroll',          'Access pay runs and payroll data',                   'Staff',         NULL,           'view',   'high',     NULL),
  ('view_reports',        'View Reports',          'Access business reports',                            'Reports',       NULL,           'view',   'medium',   NULL),
  ('export_reports',      'Export Reports',        'Download and export report data',                   'Reports',       NULL,           'export', 'high',     ARRAY['view_reports']),
  ('general_settings',    'General Settings',      'Access and update business settings',                'Settings',      NULL,           'manage', 'high',     NULL),
  ('permission_settings', 'Permission Settings',   'Manage staff roles and permissions',                 'Settings',      NULL,           'manage', 'critical', NULL),
  ('manage_pos_payments', 'POS / Payment Machine', 'Connect payment terminals and merchant credentials', 'Settings',      NULL,           'manage', 'critical', NULL),
  ('access_help_center',  'Access Help Center',    'Use the help center and support',                    'Help',          NULL,           'view',   'low',      NULL)
ON CONFLICT (key) DO NOTHING;
