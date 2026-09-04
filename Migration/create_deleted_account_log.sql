-- Super Admin "Delete Account History": deleteUser/deleteSalon are hard
-- deletes with no prior logging, so this table snapshots identifying info
-- (email/name/role) at delete time — the source users/salons row is gone
-- immediately after, so it can't be joined back later.

CREATE TABLE IF NOT EXISTS deleted_account_log (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type      VARCHAR(20)   NOT NULL CHECK (account_type IN ('user', 'salon')),
  account_id        UUID          NOT NULL,
  account_email     VARCHAR(255),
  account_name      VARCHAR(255),
  account_role      VARCHAR(50),
  deleted_by        UUID          NOT NULL,
  reason            TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deleted_account_log_created_at ON deleted_account_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deleted_account_log_account_type ON deleted_account_log(account_type);
