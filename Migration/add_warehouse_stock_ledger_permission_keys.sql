-- Warehouse -> Stock Ledger permissions (see the Warehouse -> Stock Ledger
-- ticket): independent View/Edit/Delete/Stock Adjustment/Export Excel,
-- replacing the shared view_inventory/manage_inventory/stock_adjustment
-- triple for this section specifically. Those three legacy keys remain in
-- place for stock-movements/stock-takes/stock-reconciliation — routes with
-- no nav tab of their own anymore, out of scope here.
--
-- "Stock Adjustment" covers BOTH the "Add Stock" button/page and the "Stock
-- Adjustment" modal — both call the exact same POST /stock-ledger endpoint
-- (see inventory.routes.ts), so one permission covers both entry points,
-- same as "Delete/Cancel Order" covered two actions on one key earlier.
--
-- Delete previously had NO staff access at all (owner/admin-only role gate,
-- no permission check) — widened to ownerAdminStaff + delete_stock_ledger so
-- it's actually delegable, matching the pattern already used for
-- approve_product_audit.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_stock_ledger',         'View Stock Ledger',   'Access the Stock Ledger page',                                'Warehouse', 'Stock Ledger', 'view',   'low',    NULL),
  ('edit_stock_ledger',         'Edit',                 'Edit an existing stock ledger transaction',                   'Warehouse', 'Stock Ledger', 'edit',   'medium', ARRAY['view_stock_ledger']),
  ('delete_stock_ledger',       'Delete',                'Permanently delete a stock ledger transaction',              'Warehouse', 'Stock Ledger', 'delete', 'high',   ARRAY['view_stock_ledger']),
  ('stock_ledger_adjustment',   'Stock Adjustment',     'Add stock or record a manual stock adjustment',               'Warehouse', 'Stock Ledger', 'manage', 'medium', ARRAY['view_stock_ledger']),
  ('export_stock_ledger_excel', 'Export Excel',          'Download the Stock Ledger list as Excel',                    'Warehouse', 'Stock Ledger', 'view',   'low',    ARRAY['view_stock_ledger'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
