-- Online Booking permissions ticket, UX follow-up: collapse the
-- General/Channels 2-subgroup split back into a single flat section —
-- unifying group_name removes the subgroup-picker step entirely (a module
-- only gets that "pick a subsection" screen when it has more than one
-- distinct group_name). display_order pins View Booking first, since the
-- frontend now hides the other 6 toggles until it's switched on (see
-- RolePermissionPanel.tsx / StaffPermissionEditor.tsx /
-- IndividualStaffPermissionsPage.tsx).
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permissions SET group_name = NULL, display_order = 0 WHERE key = 'view_booking';
UPDATE permissions SET group_name = NULL, display_order = 1 WHERE key = 'view_marketplace';
UPDATE permissions SET group_name = NULL, display_order = 2 WHERE key = 'manage_marketplace';
UPDATE permissions SET group_name = NULL, display_order = 3 WHERE key = 'view_reserve_with_google';
UPDATE permissions SET group_name = NULL, display_order = 4 WHERE key = 'view_social_bookings';
UPDATE permissions SET group_name = NULL, display_order = 5 WHERE key = 'view_link_builder';
UPDATE permissions SET group_name = NULL, display_order = 6 WHERE key = 'manage_link_builder';

COMMIT;
