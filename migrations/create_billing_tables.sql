-- Create billing_plans table
CREATE TABLE IF NOT EXISTS billing_plans (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  description   TEXT,
  price_per_unit NUMERIC(10,2) NOT NULL DEFAULT 0,
  billing_unit  TEXT        NOT NULL DEFAULT 'salon',
  interval      TEXT        NOT NULL DEFAULT 'monthly' CHECK (interval IN ('monthly', 'yearly')),
  trial_days    INTEGER     NOT NULL DEFAULT 0,
  trial_minutes INTEGER     NOT NULL DEFAULT 0,
  features      JSONB,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create billing_subscriptions table
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id             UUID        NOT NULL,
  plan_id              UUID        NOT NULL REFERENCES billing_plans(id),
  status               TEXT        NOT NULL DEFAULT 'active'
                         CHECK (status IN ('trialing','active','past_due','cancelled','inactive')),
  quantity             INTEGER     NOT NULL DEFAULT 1,
  unit_price           NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount         NUMERIC(10,2) NOT NULL DEFAULT 0,
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trial_ends_at        TIMESTAMPTZ,
  -- card / payment
  payment_method       TEXT        CHECK (payment_method IN ('card','upi','bank_transfer','cash')),
  card_holder_name     TEXT,
  card_last4           CHAR(4),
  card_brand           TEXT,
  card_expiry          TEXT,
  -- billing details
  account_type         TEXT,
  billing_first_name   TEXT,
  billing_last_name    TEXT,
  billing_address      TEXT,
  vat_number           TEXT,
  -- cancel
  cancelled_at         TIMESTAMPTZ,
  cancel_reason        TEXT,
  created_by           UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id        UUID        NOT NULL,
  subscription_id UUID        REFERENCES billing_subscriptions(id),
  invoice_number  TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','open','paid','void')),
  quantity        INTEGER     NOT NULL DEFAULT 1,
  unit_price      NUMERIC(10,2) NOT NULL DEFAULT 0,
  subtotal        NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  period_start    TIMESTAMPTZ,
  period_end      TIMESTAMPTZ,
  due_date        TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
