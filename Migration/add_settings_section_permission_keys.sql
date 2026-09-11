-- "Add Individual Permissions for All Settings Sections" ticket. Adds a
-- "can open and use" permission for each of the 18 Settings sections
-- (ticket text listed "Preferences" and "Configuration" as items, but
-- those are only UI category labels in SettingsLayout.tsx, not real
-- sections — removing those two duplicates gives exactly 18, matching the
-- ticket's own stated count).
--
-- Only 15 new keys here — 3 sections (Branches, Coupons, Roles &
-- Permissions) already had a real, correctly-scoped key from earlier work
-- this session (view_branches, view_coupons, view_roles) that simply had
-- no frontend UI to attach to yet; this ticket gives them that UI
-- (SettingsLayout.tsx) and reuses those keys directly rather than adding
-- redundant duplicates.
--
-- module='Settings', group_name matches the ticket's own category
-- structure (Account/Tools/Migration/Data), distinct from the existing
-- generic 'General' Settings permissions (general_settings,
-- manage_integrations) which keep their own separate meaning — writes to
-- the shared generic-settings key-value store — unchanged by this ticket.
--
-- Backend note: for Branches/Coupons/Roles (reused keys) and POS/Payment
-- Machine + Bulk Billing Import (new keys, OR'd into their existing
-- dedicated routes — see payment-settings.routes.ts/sales.routes.ts),
-- granting the permission also unlocks the real backend read. The
-- remaining 13 sections (Profile/Business/Account & Security/
-- Notifications/Integrations/Billing/Currency/Tax Mapping/Reward Points/
-- Refer & Earn/Packages/Print Settings/Data & Privacy) either share one
-- combined salon-record endpoint (Business+Currency both read via
-- getMySalonThunk) or ride the generic salon_settings key-value store with
-- no per-key backend differentiation today — for those, enforcement is
-- frontend-only (SettingsLayout.tsx), matching the ticket's literal ask
-- ("can open and use" the card); writes there still require
-- general_settings exactly as before, unchanged.
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  -- Account
  ('view_settings_profile',           'Profile',              'Open the Profile settings section',              'Settings', 'Account', 'view', 'low', NULL),
  ('view_settings_business',          'Business',             'Open the Business settings section',             'Settings', 'Account', 'view', 'low', NULL),
  ('view_settings_account_security',  'Account & Security',   'Open the Account & Security settings section',   'Settings', 'Account', 'view', 'low', NULL),
  ('view_settings_notifications',     'Notifications',        'Open the Notifications settings section',        'Settings', 'Account', 'view', 'low', NULL),

  -- Tools
  ('view_settings_integrations',      'Integrations',         'Open the Integrations settings section',         'Settings', 'Tools', 'view', 'low', NULL),
  ('view_settings_pos_payments',      'POS / Payment Machine', 'Open the POS / Payment Machine settings section', 'Settings', 'Tools', 'view', 'low', NULL),
  ('view_settings_billing',           'Billing & Plans',      'Open the Billing & Plans settings section',      'Settings', 'Tools', 'view', 'low', NULL),
  ('view_settings_currency',          'Currency',             'Open the Currency settings section',             'Settings', 'Tools', 'view', 'low', NULL),
  ('view_settings_tax_mapping',       'Tax Mapping',          'Open the Tax Mapping settings section',          'Settings', 'Tools', 'view', 'low', NULL),
  ('view_settings_reward_points',     'Reward Points',        'Open the Reward Points settings section',        'Settings', 'Tools', 'view', 'low', NULL),
  ('view_settings_referral',          'Refer & Earn',         'Open the Refer & Earn settings section',         'Settings', 'Tools', 'view', 'low', NULL),
  ('view_settings_packages',          'Packages',             'Open the Packages settings section',             'Settings', 'Tools', 'view', 'low', NULL),
  ('view_settings_print',             'Print Settings',       'Open the Print Settings section',                'Settings', 'Tools', 'view', 'low', NULL),

  -- Migration
  ('view_settings_bulk_billing_import', 'Bulk Billing Import', 'Open the Bulk Billing Import settings section', 'Settings', 'Migration', 'view', 'low', NULL),

  -- Data
  ('view_settings_data_privacy',      'Data & Privacy',       'Open the Data & Privacy settings section',       'Settings', 'Data', 'view', 'low', NULL)
ON CONFLICT (key) DO NOTHING;

-- Give the 3 reused keys a group_name matching this ticket's structure too,
-- so Branches/Coupons/Roles & Permissions show up correctly under Settings
-- (module stays whatever they already were — Warehouse/Marketing/Staff
-- respectively — this only affects how they additionally group when viewed
-- in this Settings context; permissions can belong to one module/group only,
-- so this is a deliberate choice to let their EXISTING module/group stand,
-- not a move). Left untouched deliberately: moving them would pull
-- view_branches out of wherever Warehouse's own permission tree already
-- expects it, view_coupons out of the Coupons module fixed two tickets ago,
-- and view_roles out of wherever Roles & Permissions' own catalog entry
-- lives — none of that is this ticket's concern.

COMMIT;
