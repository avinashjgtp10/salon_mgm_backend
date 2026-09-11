-- Explicit display order for the "Clients List" permission group, matching
-- the same display_order pattern used for Calendar. Requires
-- add_clients_granular_permission_keys.sql to have been run first (that's
-- what actually creates import_clients/export_clients/block_client) — if
-- those two keys aren't showing up in Settings -> Roles & Permissions yet,
-- that migration hasn't been applied to this environment.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

ALTER TABLE permissions ADD COLUMN IF NOT EXISTS display_order INTEGER;

UPDATE permissions SET display_order = 1 WHERE key = 'view_clients';
UPDATE permissions SET display_order = 2 WHERE key = 'create_clients';
UPDATE permissions SET display_order = 3 WHERE key = 'edit_clients';
UPDATE permissions SET display_order = 4 WHERE key = 'delete_clients';
UPDATE permissions SET display_order = 5 WHERE key = 'block_client';
UPDATE permissions SET display_order = 6 WHERE key = 'import_clients';
UPDATE permissions SET display_order = 7 WHERE key = 'export_clients';
