-- Removes manage_commissions/manage_tips from the permission catalog.
--
-- Both predate this Tip & Commission ticket (added by an earlier,
-- unrelated migration, add_gap_closure_permission_keys.sql) and were
-- landing inside the "Tip & Commission" group_name, cluttering it with 2
-- toggles beyond the ticket's literal 11 (View Commission/Add/Edit/Delete
-- Commission Rule/View Tip/Add/Edit/Delete Tip/Export CSV/Excel/PDF).
-- Explicit instruction: remove them entirely, not just regroup them (see
-- feedback_no_proactive_permission_backfill).
--
-- These two keys are still referenced directly by route code — the
-- commissionRules.routes.ts CRUD routes, and staff.routes.ts's
-- /commissions/:staffId/mark-paid, /commissions/bulk-configure, and the
-- edit_tip/manage_tips OR-fallback on /tips/:staffId/settle — plus
-- CommissionsPage.tsx's Settle Commission button
-- (can("manage_commissions")). None of that code is touched by this
-- migration: those actions simply become permanently closed to staff (no
-- catalog row means no way to ever grant the key again), same outcome as
-- the earlier view_wages/manage_wages/manage_staff_personal_data removal.
-- Owner/admin are unaffected (unconditional bypass).
--
-- Safe to run whether or not manage_commissions/manage_tips were ever
-- granted to any role/staff — the DELETEs are no-ops otherwise.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permission_audit_log
SET permission_key = NULL
WHERE permission_key IN ('manage_commissions', 'manage_tips');

DELETE FROM role_permissions
WHERE permission_key IN ('manage_commissions', 'manage_tips');

DELETE FROM staff_permission_overrides
WHERE permission_key IN ('manage_commissions', 'manage_tips');

DELETE FROM permissions
WHERE key IN ('manage_commissions', 'manage_tips');

COMMIT;
