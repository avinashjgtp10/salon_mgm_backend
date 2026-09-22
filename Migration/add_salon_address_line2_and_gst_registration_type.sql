-- Settings > Profile & Business redesign: Business Address gets a second
-- line, and Tax & Compliance gets a GST Registration Type. Safe to re-run.

ALTER TABLE salons ADD COLUMN IF NOT EXISTS address_line2 VARCHAR(255);
ALTER TABLE salons ADD COLUMN IF NOT EXISTS gst_registration_type VARCHAR(20);
