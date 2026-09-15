-- Cosmetic fix, same pattern as view_reports/access_settings: view_booking
-- and manage_booking currently sit with group_name = NULL (module 'Online
-- Booking'), which lands them in the accidental NULLS-FIRST ungrouped
-- bucket rather than a real named "General" group like every other module
-- with a master-toggle-plus-subgroups shape (Reports, Settings).
--
-- Not a permission removal — view_booking survives as a real, toggleable
-- master switch (see usePermissions.ts's VIRTUAL_PERMS.view_booking) and
-- manage_booking remains the sole gate on all marketplace write routes
-- (essentials/about/location/hours/images/features/publish) — this ticket
-- only added View toggles, no replacement for manage_booking exists, so it
-- is not being removed.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permissions SET group_name = 'General'
WHERE module = 'Online Booking' AND key IN ('view_booking', 'manage_booking');

COMMIT;
