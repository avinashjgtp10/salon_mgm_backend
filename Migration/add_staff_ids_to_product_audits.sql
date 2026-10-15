-- Product Audit: the auditor / reviewer can now be ANY staff member, not just staff with a login account.
-- auditor_id / reviewer_id stay as they are (users.id of the person who recorded it / has a login); these
-- columns record WHICH STAFF MEMBER it was, and are what the audit screens show first. Safe to re-run.
-- Run BEFORE deploying the matching backend code (it inserts into these columns).

ALTER TABLE product_audits ADD COLUMN IF NOT EXISTS auditor_staff_id  UUID REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE product_audits ADD COLUMN IF NOT EXISTS reviewer_staff_id UUID REFERENCES staff(id) ON DELETE SET NULL;
