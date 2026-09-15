-- Removes export_reports — confirmed dead (no route anywhere ever checked
-- it; grep found zero call sites). Its role — gating report downloads —
-- was always actually filled by the generic export_csv/export_excel/
-- export_pdf triplet inside ReportExportButton.tsx, now itself superseded
-- by the 53 per-report download_report_<id> keys added in
-- add_individual_report_permission_keys.sql. Leaving it would clutter
-- Reports' "General" group with a toggle that does nothing — that group
-- should contain only view_reports (the real, still-load-bearing top-level
-- "can enter the Reports section at all" umbrella).
--
-- Safe to run whether or not export_reports was ever granted — the DELETEs
-- are no-ops otherwise.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permission_audit_log SET permission_key = NULL WHERE permission_key = 'export_reports';
DELETE FROM role_permissions WHERE permission_key = 'export_reports';
DELETE FROM staff_permission_overrides WHERE permission_key = 'export_reports';
DELETE FROM permissions WHERE key = 'export_reports';

COMMIT;
