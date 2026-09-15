-- Warehouse -> Orders permissions: independent View Orders (list)/Create
-- Order/View Order (single)/Edit Order/Delete-Cancel Order/Receive Order,
-- replacing the shared view_inventory/manage_inventory pair for this
-- section (see the Warehouse permissions ticket). Delete Order previously
-- had NO permission check at all (role-only) — now covered by
-- cancel_order alongside Cancel, matching the ticket's single "Delete/
-- Cancel Order" line item. Download Order PDF is client-side (built from
-- already-fetched order data, no dedicated backend route) — enforced only
-- on the frontend button, same pattern as Suppliers' export.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_orders',          'View Orders',           'Access the Orders page',                              'Warehouse', 'Orders', 'view',   'low',    NULL),
  ('create_order',         'Create Order',          'Create a new purchase order',                         'Warehouse', 'Orders', 'create', 'medium', ARRAY['view_orders']),
  ('view_order',           'View Order',            'Open a single order''s details',                      'Warehouse', 'Orders', 'view',   'low',    ARRAY['view_orders']),
  ('edit_order',           'Edit Order',            'Edit an existing order',                              'Warehouse', 'Orders', 'edit',   'medium', ARRAY['view_order']),
  ('cancel_order',         'Delete/Cancel Order',   'Cancel or permanently delete an order',               'Warehouse', 'Orders', 'delete', 'high',   ARRAY['view_order']),
  ('receive_order',        'Receive Order',         'Mark items on an order as received',                  'Warehouse', 'Orders', 'manage', 'medium', ARRAY['view_order']),
  ('download_order_pdf',   'Download Order PDF',    'Download/print an order as a PDF',                    'Warehouse', 'Orders', 'view',   'low',    ARRAY['view_order'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
