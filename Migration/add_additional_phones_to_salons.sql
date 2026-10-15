-- Settings > Profile: a business can list several business numbers. salons.phone stays the PRIMARY one (it is
-- what receipts, templates and alerts already use); these are the extra ones, digits only, de-duplicated and
-- capped by the API. Safe to re-run. Run BEFORE deploying the matching backend code.

ALTER TABLE salons ADD COLUMN IF NOT EXISTS additional_phones TEXT[] NOT NULL DEFAULT '{}';
