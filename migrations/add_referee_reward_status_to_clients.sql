-- referral_reward_status tracks the REFERRER's payout status only.
-- referral_referee_rewarded tracks whether THIS client (the one who was
-- referred) has already received their own one-time welcome reward — as an
-- instant bill discount if their first paid visit met min_bill_amount, or as
-- an eWallet credit otherwise. Tracked separately so a small first visit
-- (wallet-credit fallback) doesn't block the referrer from later still
-- earning their reward once a qualifying bill comes through.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS referral_referee_rewarded BOOLEAN NOT NULL DEFAULT FALSE;
