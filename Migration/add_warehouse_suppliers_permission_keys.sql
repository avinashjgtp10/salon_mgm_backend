-- Warehouse -> Suppliers permissions: splits the old single manage_suppliers
-- key into View/Add/Edit/Delete/Payout, each independently controllable
-- (see the Warehouse permissions ticket). manage_suppliers is removed —
-- everything that checked it has been retargeted to one of the 5 new keys.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_suppliers',   'View Suppliers',   'Access the Suppliers page',                          'Warehouse', 'Suppliers', 'view',   'low',    NULL),
  ('create_suppliers', 'Add Supplier',     'Create a new supplier',                              'Warehouse', 'Suppliers', 'create', 'medium', ARRAY['view_suppliers']),
  ('edit_suppliers',   'Edit Supplier',    'Edit an existing supplier',                           'Warehouse', 'Suppliers', 'edit',   'medium', ARRAY['view_suppliers']),
  ('delete_suppliers', 'Delete Supplier',  'Permanently delete a supplier',                       'Warehouse', 'Suppliers', 'delete', 'high',   ARRAY['view_suppliers']),
  ('supplier_payout',  'Payout',           'Record a payment/payout to a supplier',              'Warehouse', 'Suppliers', 'manage', 'high',   ARRAY['view_suppliers'])
ON CONFLICT (key) DO NOTHING;

-- Nothing should reference manage_suppliers anymore after this — clean it
-- up the same way as the other removed keys this session.
UPDATE permission_audit_log SET permission_key = NULL WHERE permission_key = 'manage_suppliers';
DELETE FROM role_permissions WHERE permission_key = 'manage_suppliers';
DELETE FROM staff_permission_overrides WHERE permission_key = 'manage_suppliers';
DELETE FROM permissions WHERE key = 'manage_suppliers';

COMMIT;
