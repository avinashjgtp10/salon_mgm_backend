-- Help & Support "Request a Callback": a callback is a support ticket (category 'Callback'), so it uses the same status, reply,
-- notification and Super Admin screens as every other ticket. These columns hold what is specific to a callback.
--   callback_phone : the number to call back
--   callback_slot  : 'within_30_min' | 'within_1_hour' | 'later'
--   callback_at    : when to call — the deadline for the two "within" options, the chosen date and time for 'later'
--   callback_module: the SalonOx module the call is about (optional)
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS callback_phone TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS callback_slot  TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS callback_at    TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS callback_module TEXT;
