ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS referral_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS referral_reward_status VARCHAR(20) CHECK (referral_reward_status IN ('pending', 'completed'));

-- A client's own referral code is permanent and unique within their salon
-- (partial index so existing rows with a NULL code before backfill don't collide).
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_referral_code_per_salon
  ON clients (salon_id, referral_code)
  WHERE referral_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_referred_by ON clients (referred_by_client_id);
