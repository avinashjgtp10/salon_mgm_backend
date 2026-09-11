-- Warehouse -> Product Inventory / Consumable Inventory / Product Audit
-- permissions (see the 3 Warehouse permissions tickets for these sections).
--
-- Product Inventory: independent View Product Inventory (page)/Adjust Stock
-- (the "Receive Stock" purchase flow)/Stock History permissions. Edit/Delete
-- Product get their OWN dedicated keys (edit_product/delete_product) so they
-- show up under this Warehouse section in the Roles & Permissions UI, rather
-- than under Catalog's Products section — even though they call the exact
-- same /products PATCH/DELETE endpoints as Catalog (OR'd in as alternatives,
-- see products.routes.ts), a staff member should be able to see and toggle
-- them right here without hunting through Catalog. add_product is defined
-- here for completeness/symmetry with the ticket, but this page has no "Add
-- Product" button of its own today (only "Receive Stock", which is
-- adjust_product_stock).
--
-- Consumable Inventory: independent View/Adjust Stock/Usage permissions.
-- Add/Edit/Active-Deactive are OR'd as alternatives directly onto Catalog's
-- POST/PATCH /products routes (see products.routes.ts) since consumables
-- ARE products (product_type consumable/both) — no separate create/update
-- endpoint exists to gate on its own. Delete Consumable was requested but
-- has no backing UI or backend route anywhere in the app (no hard-delete
-- for consumables exists, only Deactivate) — skipped, same as "Clear Client
-- History" earlier in this permissions effort.
--
-- Product Audit: independent View/Create-Perform/Approve/Export Excel
-- permissions, replacing the shared view_inventory/manage_inventory pair.
-- Approve/Reject previously had NO permission check at all (owner/admin-
-- only, role-gated) — now delegable to staff via approve_product_audit.
--
-- Consumable Inventory and Product Audit's Download/Export permissions were
-- added after the fact (Product Inventory already had them from its own
-- ticket) so all three list pages behave consistently.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  -- Product Inventory
  ('view_product_inventory',        'View Product Inventory',   'Access the Product Inventory page',                    'Warehouse', 'Product Inventory', 'view',   'low',    NULL),
  ('add_product',                   'Add Product',               'Create a new retail product',                          'Warehouse', 'Product Inventory', 'create', 'medium', ARRAY['view_product_inventory']),
  ('edit_product',                  'Edit Product',              'Edit an existing retail product',                      'Warehouse', 'Product Inventory', 'edit',   'medium', ARRAY['view_product_inventory']),
  ('delete_product',                'Delete Product',            'Permanently delete a retail product',                  'Warehouse', 'Product Inventory', 'delete', 'high',   ARRAY['view_product_inventory']),
  ('adjust_product_stock',          'Adjust Stock',              'Receive stock against a supplier purchase',            'Warehouse', 'Product Inventory', 'manage', 'medium', ARRAY['view_product_inventory']),
  ('view_product_stock_history',    'Stock History',             'View a product''s stock addition history',             'Warehouse', 'Product Inventory', 'view',   'low',    ARRAY['view_product_inventory']),
  ('download_product_inventory_pdf',   'Download PDF',           'Download the Product Inventory list as PDF',           'Warehouse', 'Product Inventory', 'view',   'low',    ARRAY['view_product_inventory']),
  ('download_product_inventory_excel', 'Download Excel',         'Download the Product Inventory list as Excel',         'Warehouse', 'Product Inventory', 'view',   'low',    ARRAY['view_product_inventory']),
  ('download_product_inventory_csv',   'Download CSV',           'Download the Product Inventory list as CSV',           'Warehouse', 'Product Inventory', 'view',   'low',    ARRAY['view_product_inventory']),

  -- Consumable Inventory
  ('view_consumable_inventory',     'View Consumable Inventory', 'Access the Consumable Inventory page',                'Warehouse', 'Consumable Inventory', 'view',   'low',    NULL),
  ('add_consumable',                'Add Consumable',            'Create a new consumable product',                     'Warehouse', 'Consumable Inventory', 'create', 'medium', ARRAY['view_consumable_inventory']),
  ('edit_consumable',                'Edit Consumable',          'Edit an existing consumable product',                 'Warehouse', 'Consumable Inventory', 'edit',   'medium', ARRAY['view_consumable_inventory']),
  ('adjust_consumable_stock',       'Adjust Stock',               'Manually increase or decrease consumable stock',      'Warehouse', 'Consumable Inventory', 'manage', 'medium', ARRAY['view_consumable_inventory']),
  ('activate_deactivate_consumable', 'Active/Deactive',          'Activate or deactivate a consumable product',         'Warehouse', 'Consumable Inventory', 'manage', 'medium', ARRAY['view_consumable_inventory']),
  ('view_consumable_usage',         'Usage',                     'View consumable usage history',                       'Warehouse', 'Consumable Inventory', 'view',   'low',    ARRAY['view_consumable_inventory']),
  ('download_consumable_inventory_pdf',   'Download PDF',        'Download the Consumable Inventory list as PDF',       'Warehouse', 'Consumable Inventory', 'view',   'low',    ARRAY['view_consumable_inventory']),
  ('download_consumable_inventory_excel', 'Download Excel',      'Download the Consumable Inventory list as Excel',     'Warehouse', 'Consumable Inventory', 'view',   'low',    ARRAY['view_consumable_inventory']),
  ('download_consumable_inventory_csv',   'Download CSV',        'Download the Consumable Inventory list as CSV',       'Warehouse', 'Consumable Inventory', 'view',   'low',    ARRAY['view_consumable_inventory']),

  -- Product Audit
  ('view_product_audit',            'View Product Audit',        'Access the Product Audit page',                       'Warehouse', 'Product Audit', 'view',   'low',    NULL),
  ('create_product_audit',          'Create/Perform Audit',      'Create an audit, count products, and submit for review', 'Warehouse', 'Product Audit', 'create', 'medium', ARRAY['view_product_audit']),
  ('approve_product_audit',         'Approve Audit',             'Approve or reject a submitted audit',                 'Warehouse', 'Product Audit', 'manage', 'high',   ARRAY['view_product_audit']),
  ('export_product_audit_excel',    'Export Excel',              'Download the Product Audit list as Excel',            'Warehouse', 'Product Audit', 'view',   'low',    ARRAY['view_product_audit'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
