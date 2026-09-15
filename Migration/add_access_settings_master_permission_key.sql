-- Adds access_settings as a REAL, toggleable catalog permission — until now
-- it only existed as a frontend-only VIRTUAL_PERMS umbrella (OR of the 18
-- Settings-section keys), which meant there was no single switch an owner
-- could flip to grant "can open Settings at all"; they had to enable every
-- section individually. This mirrors the exact pattern already used for
-- view_reports (Reports ticket): a real permission row that's also included
-- in its own OR-list in usePermissions.ts, so granting it alone works, but
-- it's still additive — granting only specific sections (without this
-- master key) keeps working exactly as it does today.
--
-- group_name = 'General' (not NULL) — a literal named group, same as
-- view_reports's own 'General' group — so it sorts to the top via
-- GROUP_DISPLAY_ORDER['Settings'] (see permissionModuleOrder.ts) instead of
-- landing in the accidental NULL-grouped bucket alongside the unrelated
-- legacy manage_integrations/permission_settings/manage_pos_payments rows.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on)
VALUES (
  'access_settings',
  'Access Settings',
  'Master switch — can open and use the Settings section at all. Individual section toggles below still apply once inside.',
  'Settings',
  'General',
  'view',
  'low',
  NULL
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
