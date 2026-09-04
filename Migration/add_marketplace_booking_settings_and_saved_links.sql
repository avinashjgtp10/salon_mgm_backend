-- Marketplace Profile page has editable Tagline/Website fields and a Booking
-- Settings panel (max advance booking, minimum notice, cancellation notice,
-- slot interval) that were previously local-state-only with no column to
-- persist to. Values mirror the frontend's existing default dropdown options.
ALTER TABLE marketplace_profiles ADD COLUMN IF NOT EXISTS tagline                    VARCHAR(80);
ALTER TABLE marketplace_profiles ADD COLUMN IF NOT EXISTS website                    VARCHAR(255);
ALTER TABLE marketplace_profiles ADD COLUMN IF NOT EXISTS max_advance_days           INTEGER NOT NULL DEFAULT 30;
ALTER TABLE marketplace_profiles ADD COLUMN IF NOT EXISTS min_notice_hours           INTEGER NOT NULL DEFAULT 0;
ALTER TABLE marketplace_profiles ADD COLUMN IF NOT EXISTS cancellation_notice_hours  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE marketplace_profiles ADD COLUMN IF NOT EXISTS slot_interval_minutes      INTEGER NOT NULL DEFAULT 15;

-- Link Builder's "Saved links" panel always showed an empty state — there was
-- no table to save a generated link to. One row per link a salon chooses to
-- keep (a friendly label + the generated booking URL + what it points to).
CREATE TABLE IF NOT EXISTS marketplace_saved_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id    UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    label       VARCHAR(120) NOT NULL,
    booking_url TEXT NOT NULL,
    link_type   VARCHAR(20) NOT NULL DEFAULT 'any', -- 'any' | 'service' | 'staff'
    service_id  UUID REFERENCES services(id) ON DELETE SET NULL,
    staff_id    UUID REFERENCES staff(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_marketplace_saved_links_salon_id ON marketplace_saved_links(salon_id);
