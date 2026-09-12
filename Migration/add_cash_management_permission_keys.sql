-- Cash Management permissions ticket. view_cash_management already existed
-- (from an earlier, unrelated migration, add_gap_closure_permission_keys.sql)
-- with group_name NULL — corrected here to 'Cash Management' so it groups
-- with the rest of this module's keys instead of landing in an ungrouped
-- "General" bucket.
--
-- manage_cash_register/manage_cash_transactions (also from that same older
-- migration) are replaced by dedicated Open Counter/Close Counter and
-- Add/Edit/Delete Expenses keys per the ticket's exact 9-item list (1 view +
-- 8 action). A live-DB check confirmed neither old key has ever been
-- granted to any role or staff member, so this is a clean split with zero
-- risk of revoking an existing grant — see
-- remove_cash_management_manage_permission_keys.sql for their removal.
--
-- Export PDF/Excel/CSV are frontend-only (cashManagement.export.ts builds
-- the file client-side from already-fetched data, no backend export route
-- exists) — CashManagementPage.tsx's runExport() is the only enforcement
-- point for these three keys, same pattern as export_staff_pdf elsewhere in
-- this app.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('open_counter',                   'Open Counter',   'Open the daily cash register counter',      'Cash Management', 'Cash Management', 'manage', 'high', ARRAY['view_cash_management']),
  ('close_counter',                  'Close Counter',  'Close the daily cash register counter',      'Cash Management', 'Cash Management', 'manage', 'high', ARRAY['view_cash_management']),
  ('add_expense',                    'Add Expenses',   'Record a new cash expense entry',            'Cash Management', 'Cash Management', 'create', 'medium', ARRAY['view_cash_management']),
  ('edit_expense',                   'Edit Expenses',  'Edit an existing cash expense entry',        'Cash Management', 'Cash Management', 'edit',   'medium', ARRAY['view_cash_management']),
  ('delete_expense',                 'Delete Expenses','Permanently delete a cash expense entry',    'Cash Management', 'Cash Management', 'delete', 'high', ARRAY['view_cash_management']),
  ('export_cash_management_pdf',     'Export PDF',     'Download the Cash Management report as PDF', 'Cash Management', 'Cash Management', 'view', 'low', ARRAY['view_cash_management']),
  ('export_cash_management_excel',   'Export Excel',   'Download the Cash Management report as Excel','Cash Management', 'Cash Management', 'view', 'low', ARRAY['view_cash_management']),
  ('export_cash_management_csv',     'Export CSV',     'Download the Cash Management report as CSV', 'Cash Management', 'Cash Management', 'view', 'low', ARRAY['view_cash_management'])
ON CONFLICT (key) DO NOTHING;

UPDATE permissions SET group_name = 'Cash Management' WHERE module = 'Cash Management' AND key = 'view_cash_management';

COMMIT;
