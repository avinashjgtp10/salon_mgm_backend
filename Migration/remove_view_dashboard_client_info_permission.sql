-- view_dashboard_client_info is now fully dead: it used to gate
-- salon-dashboard.controller.ts's getCombined() redaction of
-- data.todaysBirthdays, but that's been replaced by the new, independent
-- view_dashboard_card_birthdays key (see
-- add_dashboard_card_visibility_permissions.sql). Nothing else in the
-- backend ever checked this key (confirmed via a full source search),
-- unlike its 3 siblings (view_dashboard_financials still gates Cash
-- Management's summary bundle, view_dashboard_appointments still gates the
-- Appointments list route, view_dashboard_staff_performance still gates the
-- staff revenue leaderboard) — those stay.
--
-- role_permissions/staff_permission_overrides both have a plain FK to
-- permissions.key with no ON DELETE CASCADE, so dependent rows must be
-- cleared first or the final DELETE fails.
DELETE FROM staff_permission_overrides WHERE permission_key = 'view_dashboard_client_info';
DELETE FROM role_permissions WHERE permission_key = 'view_dashboard_client_info';
DELETE FROM permissions WHERE key = 'view_dashboard_client_info';
