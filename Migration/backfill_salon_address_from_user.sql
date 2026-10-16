-- The business address now lives ONLY on salons (Settings > Profile & Business >
-- Business Address). Until now, the address/country typed at registration was stored on
-- users, while salon creation never copied it across (salonsRepository.create did not
-- insert address/country) — so many salons have an empty address even though their owner's
-- user row has one. This copies it over once, only where the salon field is still empty,
-- so nothing the owner has since typed in Settings is overwritten.
--
-- users.address / users.country are no longer read or returned by any API; the columns are
-- deliberately LEFT IN PLACE (no DROP) so this stays reversible. Run this BEFORE deploying
-- the backend change that stops returning them.

UPDATE salons s
SET address = u.address
FROM users u
WHERE s.owner_id = u.id
  AND COALESCE(NULLIF(TRIM(s.address), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(u.address), ''), NULL) IS NOT NULL;

UPDATE salons s
SET country = u.country
FROM users u
WHERE s.owner_id = u.id
  AND COALESCE(NULLIF(TRIM(s.country), ''), NULL) IS NULL
  AND COALESCE(NULLIF(TRIM(u.country), ''), NULL) IS NOT NULL;
