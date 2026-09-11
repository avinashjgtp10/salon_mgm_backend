-- Clients module permissions — Clients List / Referral & Rewards / Client
-- History, per the Clients permissions ticket. Mirrors the Calendar
-- permissions work: each action independently controllable, "never hide,
-- only disable" on the frontend, backend enforces the same keys.
--
-- create_clients already existed in the catalog but was dead — POST
-- /clients actually checked edit_clients (see
-- clients.routes.ts) — reconciled in the accompanying code change so this
-- key finally does something. import_clients/export_clients/block_client/
-- view_client_history/view_referral_rewards are new.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permissions
SET group_name = 'Clients List'
WHERE key IN ('view_clients', 'create_clients', 'edit_clients', 'delete_clients');

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('import_clients',      'Import Clients',        'Bulk-import client records from an Excel/CSV file', 'Clients', 'Clients List',       'manage', 'high',   ARRAY['view_clients']),
  ('export_clients',      'Export Clients',        'Export the client list as CSV/Excel/PDF',           'Clients', 'Clients List',       'view',   'medium', ARRAY['view_clients']),
  ('block_client',        'Block Client',          'Block or unblock a client from booking',            'Clients', 'Clients List',       'manage', 'medium', ARRAY['view_clients']),
  ('view_client_history', 'View Client History',   'Open a client''s visit/purchase history',           'Clients', 'Client History',     'view',   'low',    ARRAY['view_clients']),
  ('view_referral_rewards','View Referral & Rewards','Access the Referral & Rewards page',               'Clients', 'Referral & Rewards', 'view',   'low',    ARRAY['view_clients'])
ON CONFLICT (key) DO NOTHING;

COMMIT;
