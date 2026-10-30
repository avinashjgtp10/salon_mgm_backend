-- Settings > Payment Methods: salon-defined payment methods that behave like
-- Cash / Card / UPI at checkout (single or split leg) and in reports.
--
-- Custom methods are stored by NAME on history rows (payments.payment_method is
-- free text; sales.payment_method / payment_reference carry the same name), so
-- renaming or deactivating a method later never rewrites old transactions —
-- old rows keep the name they were recorded with.
--
-- sales.payment_method was limited by sales_payment_method_check to a fixed
-- list, which would reject any custom name and leave a PAID appointment with no
-- invoice. The fixed list is replaced with a non-empty check; the application
-- (payment-method.util.ts + the payment-methods module) is what vets names now.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand
-- against each environment (dev/QA/prod) in that order, BEFORE deploying the
-- backend.

BEGIN;

CREATE TABLE IF NOT EXISTS salon_payment_methods (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id    UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name        VARCHAR(40) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  UUID NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One name per salon, ignoring case/outer spaces ("Cheque" == "cheque ").
CREATE UNIQUE INDEX IF NOT EXISTS uq_salon_payment_methods_salon_name
  ON salon_payment_methods (salon_id, LOWER(BTRIM(name)));

CREATE INDEX IF NOT EXISTS idx_salon_payment_methods_salon_active
  ON salon_payment_methods (salon_id, is_active);

ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IS NULL OR BTRIM(payment_method) <> '');

INSERT INTO permissions (key, name, description, module, group_name, action, risk_level, depends_on) VALUES
  ('view_settings_payment_methods', 'Payment Methods', 'Open the Payment Methods settings section', 'Settings', 'Tools', 'view',   'low',    NULL),
  ('manage_payment_methods',        'Payment Methods', 'Add, edit, activate and deactivate custom payment methods', 'Settings', 'Tools', 'manage', 'medium', 'view_settings_payment_methods')
ON CONFLICT (key) DO NOTHING;

COMMIT;
