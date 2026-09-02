-- DINGG-parity client profile fields for the New Client form: tax/identity
-- (GST, Client Code, Identification Number), credit terms, lead tracking,
-- and a WhatsApp-capability flag for the primary mobile number.
-- clients.state and clients.pincode already exist on this table (added in
-- an earlier, unrecorded migration) and are intentionally NOT touched here
-- — they only needed application-layer wiring, not a schema change.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS gst_number            VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_code           VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS identification_number VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS credit_limit          NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS credit_duration_days  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS lead_source           VARCHAR(50);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS source_description    TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS has_whatsapp          BOOLEAN NOT NULL DEFAULT true;
