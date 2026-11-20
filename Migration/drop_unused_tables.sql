-- Drops tables no backend code reads or writes. Run by hand.
--
-- KEPT ON PURPOSE (they hold data): order_receipts, order_receipt_items, wa_review_prompts (5 rows on production).
--
-- Safe to re-run: every DROP uses IF EXISTS. It also REFUSES to run (and changes nothing) if any table in the
-- list holds rows on the database you run it against, so check the result of that guard before trusting it on production.
-- The tables are dropped WITHOUT CASCADE, so anything unexpected that depends on them makes the whole script fail and roll back.
--
-- Schema these tables had is not kept anywhere in the repo; every one was empty on the dev database when this was written.

BEGIN;

-- 1. Guard: stop if any of these tables has data.
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ai_agent_logs', 'ai_customer_memory', 'ai_token_usage',
    'ai_chat_sessions', 'ai_predictions', 'ai_recommendations', 'business_health_scores',
    'marketplace_listings', 'marketplace_bookings', 'marketplace_booking_settings', 'marketplace_reviews', 'marketplace_wishlist',
    'bookings_archive', 'invoices_archive',
    'client_preferences', 'commission_rule_tiers', 'branch_stock', 'stock_transfers', 'loyalty_settings',
    'whatsapp_credits', 'salon_group_members', 'salon_invoice_counters',
    'booking_services', 'staff_services', 'staff_branches', 'staff_invitations'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT COUNT(*) FROM public.%I', t) INTO n;
      IF n > 0 THEN
        RAISE EXCEPTION 'Table % has % row(s): refusing to drop it. Nothing was changed.', t, n;
      END IF;
    END IF;
  END LOOP;
END $$;

-- 2. commission_earned.tier_id points at commission_rule_tiers (ON DELETE SET NULL). commission_earned is a LIVE table
--    (its tier_id is NULL on every row on dev), so only the foreign-key constraint is removed; the column and the data stay.
ALTER TABLE IF EXISTS commission_earned DROP CONSTRAINT IF EXISTS commission_earned_tier_id_fkey;

-- 3. Drop them. marketplace_bookings / _reviews / _wishlist reference marketplace_listings, so all are dropped together.
--    (No CASCADE on purpose.)
DROP TABLE IF EXISTS
  ai_agent_logs, ai_customer_memory, ai_token_usage,
  ai_chat_sessions, ai_predictions, ai_recommendations, business_health_scores,
  marketplace_bookings, marketplace_reviews, marketplace_wishlist, marketplace_booking_settings, marketplace_listings,
  bookings_archive, invoices_archive,
  client_preferences, commission_rule_tiers, branch_stock, stock_transfers, loyalty_settings,
  whatsapp_credits, salon_group_members, salon_invoice_counters,
  booking_services, staff_services, staff_branches, staff_invitations;

COMMIT;
