-- 8 fully independent per-card/panel visibility toggles for the main
-- Dashboard, replacing the previous "one shared switch controls 3+ cards"
-- grouping (view_dashboard_financials covered Total Revenue + Today's
-- Revenue + Due Amount + Revenue Overview + Overall Collection all at once).
-- An owner wants Total Revenue, Today's Revenue, Due Amount, Appointments,
-- Today's Birthdays, New Clients, Revenue Overview, and Overall Collection
-- each toggleable on their own, per role/staff member.
--
-- These are NEW, additive keys — view_dashboard_financials/_appointments/
-- _client_info are NOT removed or renamed, since they're still real,
-- separately-enforced gates elsewhere (appointments.routes.ts's GET / list
-- endpoint, cash-management.controller.ts's own financial-visibility check).
-- Only salon-dashboard.controller.ts's getCombined() (the bundled dashboard
-- payload) now reads these 8 new keys instead of the old 3-key grouping.
--
-- Grouped under module='Dashboard' alongside view_dashboard, no depends_on —
-- display-only toggles enforced in getCombined()'s field redaction, same
-- shape as the pre-existing view_dashboard_financials/_appointments/
-- _client_info.
INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_dashboard_card_total_revenue',       'Total Revenue Card',      'See the Total Revenue KPI card on the dashboard',        'Dashboard', NULL, 'view', 'low', NULL),
  ('view_dashboard_card_today_revenue',       'Today''s Revenue Card',   'See the Today''s Revenue KPI card on the dashboard',     'Dashboard', NULL, 'view', 'low', NULL),
  ('view_dashboard_card_due_amount',          'Due Amount Card',        'See the Due Amount (pending payments) card on the dashboard', 'Dashboard', NULL, 'view', 'low', NULL),
  ('view_dashboard_card_appointments',        'Appointments Card',      'See the Appointments Today KPI card on the dashboard',   'Dashboard', NULL, 'view', 'low', NULL),
  ('view_dashboard_card_birthdays',           'Today''s Birthdays Card', 'See the Today''s Birthdays card on the dashboard',       'Dashboard', NULL, 'view', 'low', NULL),
  ('view_dashboard_card_new_clients',         'New Clients Card',       'See the New Clients KPI card on the dashboard',          'Dashboard', NULL, 'view', 'low', NULL),
  ('view_dashboard_card_revenue_overview',    'Revenue Overview Card',  'See the Revenue Overview chart on the dashboard',        'Dashboard', NULL, 'view', 'low', NULL),
  ('view_dashboard_card_overall_collection',  'Overall Collection Card','See the Overall Collection payment breakdown on the dashboard', 'Dashboard', NULL, 'view', 'low', NULL)
ON CONFLICT (key) DO NOTHING;

-- Backfill allowed=true for every EXISTING role on all 8 new keys, so
-- dashboards look identical right after deploy — a brand-new permission key
-- with no explicit role_permissions row resolves to DENIED for any role
-- already on the role_id-backed path (see permission.middleware.ts's
-- staffHasPermission — "an unconfigured permission is a deliberate deny"
-- once a role has a real role_id). Without this, every staff member would
-- see all 8 cards vanish the moment this migration runs, until an owner
-- manually re-enables them one by one. Owners can then opt individual
-- cards OFF per role afterward as normal.
INSERT INTO role_permissions (role_id, permission_key, allowed)
SELECT r.id, p.key, TRUE
FROM roles r
CROSS JOIN (VALUES
  ('view_dashboard_card_total_revenue'),
  ('view_dashboard_card_today_revenue'),
  ('view_dashboard_card_due_amount'),
  ('view_dashboard_card_appointments'),
  ('view_dashboard_card_birthdays'),
  ('view_dashboard_card_new_clients'),
  ('view_dashboard_card_revenue_overview'),
  ('view_dashboard_card_overall_collection')
) AS p(key)
ON CONFLICT (role_id, permission_key) DO NOTHING;
