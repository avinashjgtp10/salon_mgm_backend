-- Purchases: record WHICH STAFF MEMBER physically received the stock.
-- purchases.created_by is the logged-in user who typed the purchase in (often
-- the owner, entering it later), which says nothing about who actually took
-- delivery. received_by_staff_id is chosen explicitly on Record Purchase /
-- Receive Against Order so a short or damaged delivery can be traced back.
--
-- Nullable on purpose — every purchase recorded before this has no value, and
-- the API accepts it as optional so an older frontend keeps working. ON DELETE
-- SET NULL so removing a staff member never blocks (or erases) the purchase.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand
-- against each environment (dev/QA/prod) BEFORE deploying the backend — the
-- purchase INSERT references this column. Idempotent.
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS received_by_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL;
