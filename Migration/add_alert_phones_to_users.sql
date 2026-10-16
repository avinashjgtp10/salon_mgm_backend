-- Settings > Profile: the owner can list several WhatsApp Alerts numbers. users.phone stays the PRIMARY one
-- (cash counter open/close alerts already go there); these are the extra recipients, digits only,
-- de-duplicated and capped by the API. Safe to re-run. Run BEFORE deploying the matching backend code.

ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_phones TEXT[] NOT NULL DEFAULT '{}';
