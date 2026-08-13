-- Client-facing membership info popover already shows the description saved
-- at creation time (client_memberships.description); client_packages has no
-- equivalent column, so the same popover on a sold package can't show one.
-- NULL for every package sold before this column existed.

ALTER TABLE client_packages
    ADD COLUMN IF NOT EXISTS description TEXT;
