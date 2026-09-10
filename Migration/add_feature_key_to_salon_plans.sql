-- Adds stable, never-renamed featureKeys (snake_case) to
-- salon_plan_definitions, alongside the existing display-name "features"
-- array. The display names in "features" are admin-editable (Pricing Plans
-- tab lets a super admin rename/add/remove them) — that's fine for what a
-- salon owner reads on a pricing card, but it's unsafe as the actual
-- enforcement key: renaming "Meta Marketing" to "Marketing Suite" would
-- silently break every route/sidebar item gated on the old string. featureKey
-- is the new source of truth requirePlanFeature()/hasFeature() check against;
-- "features" stays purely for display.
--
-- feature_keys duplicates some information already implied by "features",
-- but keeps the two concerns (what to SHOW vs what to GATE) independently
-- editable — a super admin can rename a feature's marketing copy without
-- touching what it unlocks, and vice versa.

ALTER TABLE salon_plan_definitions
  ADD COLUMN IF NOT EXISTS feature_keys JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Basic gets every core operational key so no paying salon is ever left
-- non-functional — this fixes a gap in the original catalog (copied
-- verbatim from the marketing landing page) where Basic had no client or
-- staff management key at all. Advance/Pro are additive on top, matching
-- the landing page's own "Everything in X, plus..." structure.
UPDATE salon_plan_definitions SET feature_keys = '[
  "dashboard", "quick_sale", "calendar", "services", "products",
  "clients", "staff", "cash_management", "reports"
]'::jsonb WHERE tier = 'basic';

UPDATE salon_plan_definitions SET feature_keys = '[
  "inventory", "staff_performance", "advanced_reports", "offers_discounts",
  "memberships", "packages", "marketing", "whatsapp_sms", "data_export", "payroll"
]'::jsonb WHERE tier = 'advance';

UPDATE salon_plan_definitions SET feature_keys = '[
  "loyalty_program", "advanced_analytics", "multi_branch", "advanced_permissions",
  "customer_segmentation", "api_integrations", "advanced_financial_reports", "priority_support"
]'::jsonb WHERE tier = 'pro';
