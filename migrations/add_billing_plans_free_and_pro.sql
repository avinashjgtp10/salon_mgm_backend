-- Step 1: Add trial_minutes column if it doesn't exist
ALTER TABLE billing_plans
  ADD COLUMN IF NOT EXISTS trial_minutes INTEGER NOT NULL DEFAULT 0;

-- Step 2: Insert Free plan (5-minute trial)
INSERT INTO billing_plans (name, description, price_per_unit, billing_unit, interval, trial_days, trial_minutes, features, is_active)
SELECT
  'Free',
  'Try all core features free for 5 minutes. No credit card required.',
  '0.00',
  'salon',
  'monthly',
  0,
  5,
  '{"appointments": true, "client_management": true, "basic_scheduling": true, "upi_cash_payments": true}',
  true
WHERE NOT EXISTS (SELECT 1 FROM billing_plans WHERE name = 'Free');

-- Step 3: Insert Pro Annual plan (₹10,000/year)
INSERT INTO billing_plans (name, description, price_per_unit, billing_unit, interval, trial_days, trial_minutes, features, is_active)
SELECT
  'Pro',
  'Everything you need to run and grow your salon — billed annually.',
  '10000.00',
  'salon',
  'yearly',
  0,
  0,
  '{"unlimited_staff": true, "appointments": true, "client_management": true, "whatsapp_marketing": true, "analytics_reports": true, "ai_features": true, "payroll_commissions": true, "inventory_management": true, "online_booking": true, "loyalty_program": true, "gst_billing": true, "priority_support": true}',
  true
WHERE NOT EXISTS (SELECT 1 FROM billing_plans WHERE name = 'Pro');
