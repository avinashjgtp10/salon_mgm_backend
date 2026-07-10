ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS batch_id UUID,
  ADD COLUMN IF NOT EXISTS batch_label VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_coupons_batch_id
  ON coupons (salon_id, batch_id)
  WHERE batch_id IS NOT NULL;
