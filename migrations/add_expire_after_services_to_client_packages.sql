-- Migration: add expire_after_services to client_packages
--
-- Package Templates can now optionally define an aggregate-session cap
-- ("Expires after this many services") — once a client has completed this
-- many TOTAL sessions across ALL services in the package combined (not
-- per-service), the package closes early, same as when every service's own
-- sessions run out.
--
-- package_templates.expire_after_services (see package-templates.repository.ts,
-- auto-migrated on backend startup) is the template's own definition. This
-- column is the copy stamped onto each SOLD instance at purchase time
-- (client-packages.repository.ts create()) — a template can be edited or
-- deleted after being sold, so the instance must keep the cap it was
-- actually sold under, exactly like expiry_date is copied rather than
-- referencing the template live.
--
-- Enforced in client-packages.repository.ts completeSession(): after every
-- session deduction, if this is set and SUM(completed_sessions) across the
-- package's services >= this value, client_packages.status flips to
-- 'Completed' immediately, regardless of individual services' remaining
-- sessions.
--
-- NULL for every pre-existing row and for packages sold from a template with
-- no cap set — behaves exactly as before.
--
-- NOT run automatically.

ALTER TABLE client_packages
  ADD COLUMN IF NOT EXISTS expire_after_services INTEGER NULL;
