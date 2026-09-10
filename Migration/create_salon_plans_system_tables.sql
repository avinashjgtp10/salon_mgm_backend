-- Salon Subscription Plans system: the fixed 3-tier catalog (Basic / Advance
-- / Pro, matching the public landing page's PURCHASE_PLANS in
-- components/Landing/Pricing/Pricing.tsx) plus per-salon admin customization
-- and this system's own billing history.
--
-- Deliberately separate from billing_plans/billing_subscriptions/invoices
-- (the existing Razorpay-backed self-serve billing system in
-- modules/billing and modules/subscriptions) — those model what a salon
-- owner buys and pays for themselves via Razorpay checkout. This models the
-- super-admin-managed 3-tier catalog and per-salon overrides described in
-- the Plans & Subscriptions admin screen (features/super-admin/pages/
-- PlansManagementPage.tsx), which has no Razorpay/payment-gateway
-- involvement — an admin sets price/limits/features directly.

-- ── Fixed plan catalog (Basic / Advance / Pro only — enforced by the CHECK
--    below, never a 4th tier) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salon_plan_definitions (
  tier              VARCHAR(20)   PRIMARY KEY CHECK (tier IN ('basic', 'advance', 'pro')),
  name              VARCHAR(50)   NOT NULL,
  tagline           TEXT,
  price             NUMERIC(10,2) NOT NULL,
  features          JSONB         NOT NULL DEFAULT '[]'::jsonb, -- ordered array of feature-name strings, this tier's own (non-cumulative) additions
  default_staff_limit        INT,  -- NULL = unlimited
  default_customer_limit     INT,
  default_appointment_limit  INT,
  default_branch_limit       INT,
  default_storage_limit_gb   INT,
  updated_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Seed the 3 fixed tiers with the landing page's current numbers — an admin
-- can edit price/tagline/features/limits afterward via the Pricing Plans
-- tab, but the 3 rows themselves are permanent (insert-once, never deleted).
INSERT INTO salon_plan_definitions (tier, name, tagline, price, features, default_staff_limit, default_customer_limit, default_appointment_limit, default_branch_limit, default_storage_limit_gb)
VALUES
  ('basic', 'Basic',
   'For business looking for essential management features to get started.',
   8000,
   '["Mobile App","Dashboard","Quick Sale","Calendar","Services","Products","Limited Reports"]'::jsonb,
   5, 1000, 1500, 1, 5),
  ('advance', 'Advance',
   'For business that need complete salon management functionality.',
   12000,
   '["Full Dashboard access","Memberships","Packages","Full Reports","Staff Management","Client Management","Inventory Management","Payroll","Enquiry","Cash Management","Settings"]'::jsonb,
   20, 5000, 6000, 2, 25),
  ('pro', 'Pro',
   'For growing business that need advanced digital and multi-branch capabilities.',
   15000,
   '["Web Building","Google SEO","Meta Marketing","Multi-Branch Handling","Advanced Reports","Consultation"]'::jsonb,
   NULL, NULL, NULL, NULL, 100)
ON CONFLICT (tier) DO NOTHING;

-- ── Per-salon customization (Glow Salon example: custom price/limits/feature
--    overrides layered on top of one of the 3 fixed tiers — never a
--    separate 4th plan; the salon still shows its base tier's name with a
--    "Special pricing"/"Custom configuration" tag when overridden) ──────────
CREATE TABLE IF NOT EXISTS salon_plan_customizations (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id           UUID          NOT NULL UNIQUE REFERENCES salons(id) ON DELETE CASCADE,
  base_tier          VARCHAR(20)   NOT NULL REFERENCES salon_plan_definitions(tier),
  custom_price       NUMERIC(10,2),          -- NULL = use base_tier's standard price
  staff_limit        INT,                    -- NULL = unlimited
  customer_limit     INT,
  appointment_limit  INT,
  branch_limit       INT,
  storage_limit_gb   INT,
  feature_overrides  JSONB         NOT NULL DEFAULT '{}'::jsonb, -- { "<feature name>": true|false }, only for features overridden off the base tier's default
  start_date         DATE          NOT NULL DEFAULT CURRENT_DATE,
  expiry_date        DATE,
  updated_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_plan_customizations_salon_id ON salon_plan_customizations(salon_id);
CREATE INDEX IF NOT EXISTS idx_salon_plan_customizations_base_tier ON salon_plan_customizations(base_tier);

-- ── Billing history for this system (separate from the Razorpay invoices
--    table used by modules/billing — these are admin-recorded, not
--    gateway-generated) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salon_plan_invoices (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number VARCHAR(30)   NOT NULL UNIQUE,
  salon_id       UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  plan_tier      VARCHAR(20)   NOT NULL REFERENCES salon_plan_definitions(tier),
  amount         NUMERIC(10,2) NOT NULL,
  status         VARCHAR(20)   NOT NULL DEFAULT 'open' CHECK (status IN ('paid', 'open', 'overdue', 'void')),
  issued_date    DATE          NOT NULL DEFAULT CURRENT_DATE,
  due_date       DATE,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_salon_plan_invoices_salon_id ON salon_plan_invoices(salon_id);
CREATE INDEX IF NOT EXISTS idx_salon_plan_invoices_status ON salon_plan_invoices(status);
CREATE INDEX IF NOT EXISTS idx_salon_plan_invoices_issued_date ON salon_plan_invoices(issued_date DESC);
