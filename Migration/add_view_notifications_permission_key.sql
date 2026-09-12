-- Notifications permission module ticket: Settings → Roles & Permissions
-- gets a new single-toggle "Notifications" module — ON lets a role/staff
-- member use the notification bell + the Notifications feed page, OFF
-- leaves both visible but disabled (never hidden).
--
-- This is a brand-new permission — the bell/feed page (notifications.routes.ts,
-- DashboardTopbar.tsx, dashboard/pages/NotificationsPage.tsx) previously had
-- no permission check at all (auth only), so every staff member could use it
-- unconditionally. Defaults to false here, same as every other permission
-- added this project (Settings sections, Reports, Enquiries add/edit) — an
-- owner must explicitly grant it per role/staff after this ships.
--
-- Distinct from the pre-existing view_settings_notifications key, which
-- gates the separate "Notification Preferences" card under
-- Settings → Account (whether to receive certain alerts at all) — this one
-- gates using the notification bell/feed feature itself.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on)
VALUES (
  'view_notifications',
  'View Notifications',
  'Use the notification bell and the Notifications page',
  'Notifications',
  NULL,
  'view',
  'low',
  NULL
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
