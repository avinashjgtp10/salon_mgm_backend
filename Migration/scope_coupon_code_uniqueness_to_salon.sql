-- coupons.code was unique GLOBALLY (coupons_code_key: UNIQUE (code)) instead
-- of per salon. Two different salons picking the same code (e.g. "TEST")
-- hit a real Postgres unique-violation on INSERT even though the app's own
-- pre-check (couponsRepository.findByCodeOwn) is correctly scoped to
-- salon_id and found nothing wrong for the current salon — the request then
-- failed with the generic 23505 handler's "A client with this value already
-- exists" message (see the matching fix in error.middleware.ts), which was
-- doubly confusing: wrong salon colliding, wrong entity named in the message.
--
-- Replaces the single global constraint with a per-salon one. A NULL
-- salon_id (a possible future "global"/template coupon shared across every
-- salon — see couponsRepository.findByCodeForSalon's "OR salon_id IS NULL"
-- handling; no such rows exist today) is kept unique among itself via a
-- second partial index, so that path isn't left silently unenforced.

BEGIN;

ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS coupons_salon_code_uq
  ON coupons (salon_id, code)
  WHERE salon_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS coupons_global_code_uq
  ON coupons (code)
  WHERE salon_id IS NULL;

COMMIT;
