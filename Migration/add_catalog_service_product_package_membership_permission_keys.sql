-- Catalog permissions ticket (Service Menu / Products / Packages / Membership).
-- All four already had a page-view + create/edit/delete core (view_services,
-- view_products/edit_products/delete_products, view_memberships/
-- create_packages) enforced on the backend, seeded under module='Catalog'
-- with group_name 'Services'/'Products'/'Memberships'/'Packages' back in
-- create_permissions_system_tables.sql — this migration adds the
-- finer-grained action permissions the ticket asks for under those SAME
-- existing group names, so the Roles & Permissions UI's Catalog drill-down
-- shows exactly 4 sections (Services/Products/Packages/Memberships) instead
-- of splitting Packages into extra sub-groups. edit_packages/
-- edit_memberships/delete_memberships are already covered by
-- add_gap_closure_permission_keys.sql, not repeated here.
--
-- Service Menu (group_name 'Services'): delete_services/manage_categories/
-- import_services are OR'd as alternatives to the existing edit_services/
-- import_file on their routes (see services.routes.ts/categories.routes.ts)
-- — granting only the new dedicated key works without needing the older,
-- broader one. print_menu_card is frontend-only (PrintMenuCardModal has no
-- backend call). download_service_menu_* are OR'd with the generic
-- export_pdf/excel/csv.
--
-- Products (group_name 'Products'): import_products/download_products_*
-- OR'd with the existing create_products/import_file/export_* on
-- products.routes.ts.
--
-- Packages (group_name 'Packages', matching the legacy package-builder rows
-- already there) — covers TWO distinct pages that used to have zero or
-- shared-only gating, both intentionally kept in the SAME group_name as the
-- legacy builder so Catalog shows one "Packages" section, not three:
--   - "Client Packages" (client-packages.routes.ts) — sold/purchased
--     package instances per client. Writes here had ZERO permission check
--     at all before this ticket (role-only) — view_client_packages/
--     create_package/edit_package/delete_package now close that gap for
--     real, replacing the earlier abandoned manage_client_purchase_history
--     attempt.
--   - "Package Templates" (package-templates.routes.ts) — sellable package
--     definitions. view_package_templates/add_package_template/
--     edit_package_template/delete_package_template are OR'd as
--     alternatives to the legacy view_packages/create_packages/
--     edit_packages/delete_packages so the two pages can still be delegated
--     independently (distinct permission KEYS) even though they now share
--     one display group with the legacy builder.
--
-- Membership (group_name 'Memberships', matching the existing rows):
-- download_membership_* OR'd with the generic export_pdf/excel/csv on
-- memberships.routes.ts.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  -- Service Menu
  ('delete_services',             'Delete Service',        'Permanently delete a service',                         'Catalog', 'Services', 'delete', 'high',   ARRAY['view_services']),
  ('manage_categories',           'Manage Categories',     'Create, edit and delete service categories',           'Catalog', 'Services', 'manage', 'medium', ARRAY['view_services']),
  ('import_services',             'Import Services',       'Bulk-import services from a file',                     'Catalog', 'Services', 'manage', 'high',   ARRAY['view_services']),
  ('print_menu_card',             'Print Menu Card',       'Print a customer-facing service menu card',            'Catalog', 'Services', 'view',   'low',    ARRAY['view_services']),
  ('download_service_menu_pdf',   'Export / Download PDF', 'Download the Service Menu list as PDF',                'Catalog', 'Services', 'view',   'low',    ARRAY['view_services']),
  ('download_service_menu_excel', 'Export / Download Excel', 'Download the Service Menu list as Excel',            'Catalog', 'Services', 'view',   'low',    ARRAY['view_services']),
  ('download_service_menu_csv',   'Export / Download CSV',  'Download the Service Menu list as CSV',               'Catalog', 'Services', 'view',   'low',    ARRAY['view_services']),

  -- Products
  ('import_products',             'Import Products',       'Bulk-import products from a file',                     'Catalog', 'Products', 'manage', 'high',   ARRAY['view_products']),
  ('download_products_pdf',       'Export Products (PDF)',  'Download the Products list as PDF',                   'Catalog', 'Products', 'view',   'low',    ARRAY['view_products']),
  ('download_products_excel',     'Export Products (Excel)', 'Download the Products list as Excel',                'Catalog', 'Products', 'view',   'low',    ARRAY['view_products']),
  ('download_products_csv',       'Export Products (CSV)',  'Download the Products list as CSV',                   'Catalog', 'Products', 'view',   'low',    ARRAY['view_products']),

  -- Packages -> Client Packages (client-packages.routes.ts)
  ('view_client_packages',        'View Client Packages',  'Access the Client Packages page',                      'Catalog', 'Packages', 'view',   'low',    NULL),
  ('create_package',              'Create Package',        'Sell/assign a package to a client',                    'Catalog', 'Packages', 'create', 'medium', ARRAY['view_client_packages']),
  ('edit_package',                'Edit Package',          'Edit a client''s purchased package, incl. completing sessions', 'Catalog', 'Packages', 'edit', 'medium', ARRAY['view_client_packages']),
  ('delete_package',              'Delete Package',        'Permanently delete a client''s purchased package',     'Catalog', 'Packages', 'delete', 'high',   ARRAY['view_client_packages']),

  -- Packages -> Package Templates (package-templates.routes.ts)
  ('view_package_templates',      'View Package Templates', 'Access the Package Templates page',                   'Catalog', 'Packages', 'view',   'low',    NULL),
  ('add_package_template',        'Add Package Template',  'Create a new package template',                        'Catalog', 'Packages', 'create', 'medium', ARRAY['view_package_templates']),
  ('edit_package_template',       'Edit Package Template', 'Edit an existing package template',                    'Catalog', 'Packages', 'edit',   'medium', ARRAY['view_package_templates']),
  ('delete_package_template',     'Delete Package Template', 'Permanently delete a package template',              'Catalog', 'Packages', 'delete', 'high',   ARRAY['view_package_templates']),

  -- Membership
  ('download_membership_pdf',     'Download PDF',          'Download the Membership list as PDF',                  'Catalog', 'Memberships', 'view',   'low',    ARRAY['view_memberships']),
  ('download_membership_excel',   'Download Excel',        'Download the Membership list as Excel',                'Catalog', 'Memberships', 'view',   'low',    ARRAY['view_memberships']),
  ('download_membership_csv',     'Download CSV',          'Download the Membership list as CSV',                  'Catalog', 'Memberships', 'view',   'low',    ARRAY['view_memberships'])
ON CONFLICT (key) DO NOTHING;

-- Moves the 3 leftover pre-Warehouse-split permissions (view_inventory/
-- manage_inventory/stock_adjustment) out of Catalog entirely — they predate
-- Warehouse being split out into its own top-level sidebar section, and
-- were the 7th unrelated group cluttering Catalog's drill-down (alongside
-- the 4 real ticket sections above). Merged into Warehouse's existing
-- "Stock Ledger" group since that's genuinely what they still gate today
-- (stock-movements/stock-takes/stock-reconciliation — legacy routes with no
-- nav tab of their own anymore). Purely a catalog-display fix — these keys'
-- enforcement (string-literal requirePermission calls) is untouched.
UPDATE permissions
SET module = 'Warehouse', group_name = 'Stock Ledger'
WHERE key IN ('view_inventory', 'manage_inventory', 'stock_adjustment')
  AND module = 'Catalog';

COMMIT;
