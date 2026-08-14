ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_enquiries_follow_up_at ON enquiries (salon_id, follow_up_at);
