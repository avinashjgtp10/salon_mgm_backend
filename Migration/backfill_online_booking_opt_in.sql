-- DECISION-OB-001 / BUG-OB-011 — Online Booking becomes OPT-IN.
--
-- The public booking flow now requires marketplace_profiles.is_published = true.
-- Previously a salon with no profile row at all counted as published, so most
-- salons were publicly bookable without ever opting in.
--
-- ⚠️  RUN THIS BEFORE DEPLOYING THE OPT-IN CHANGE.
--     Without it, every salon that is live today but has no profile row (or an
--     unset is_published) stops accepting bookings the moment the code ships,
--     and their existing links/QR codes start returning "not accepting online
--     bookings".
--
-- Grandfathering rule: a salon counts as already live if it has ever taken an
-- online booking, or has saved a booking link. Those salons are published so
-- nothing breaks for them. Every other salon starts unpublished and must opt in
-- from Marketplace Profile → Enable online booking.

BEGIN;

-- 1. Salons that are demonstrably live but have no profile row yet — create one,
--    published. display_name is NOT NULL, so seed it from the salon's own name.
INSERT INTO marketplace_profiles (salon_id, display_name, is_published)
SELECT s.id,
       COALESCE(NULLIF(s.business_name, ''), 'My Salon'),
       TRUE
FROM salons s
WHERE NOT EXISTS (SELECT 1 FROM marketplace_profiles mp WHERE mp.salon_id = s.id)
  AND (
        EXISTS (
          SELECT 1 FROM appointments a
          WHERE a.salon_id = s.id AND a.created_by IS NULL   -- created by the public booking flow
        )
     OR EXISTS (
          SELECT 1 FROM marketplace_saved_links l WHERE l.salon_id = s.id
        )
      );

-- 2. Salons that already have a profile row with is_published unset.
--
--    A profile row only exists because someone saved something on the
--    Marketplace Profile page, so its presence IS the opt-in — deliberately
--    broader than step 1's "has taken a booking" test, because a salon that
--    configured Online Booking and is handing out its link but hasn't had a
--    booking yet would otherwise go dark with no warning.
--
--    An explicit FALSE is left alone: that salon switched online booking off
--    on purpose and must stay off.
UPDATE marketplace_profiles
SET is_published = TRUE,
    updated_at   = NOW()
WHERE is_published IS NULL;

COMMIT;

-- Review afterwards:
--   SELECT count(*) FILTER (WHERE is_published) AS published,
--          count(*) FILTER (WHERE NOT is_published) AS unpublished
--   FROM marketplace_profiles;
