ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS pricing_type VARCHAR(20) NOT NULL DEFAULT 'value',
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2);

ALTER TABLE memberships
  ADD CONSTRAINT memberships_discount_percent_range
  CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100));

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS login_role VARCHAR(20) NOT NULL DEFAULT 'staff',
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE staff
  DROP COLUMN IF EXISTS password;

CREATE INDEX IF NOT EXISTS idx_staff_user_id ON staff(user_id);
