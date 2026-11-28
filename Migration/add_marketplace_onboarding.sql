-- SalonOx Marketplace: salon onboarding, review and per-service Marketplace settings.
--
-- Only ADDS things: two new tables, two new columns and one index. No existing row is changed or removed,
-- and it is safe to run twice.
--
-- Run it BEFORE using the new Marketplace add-on. Until then the public Marketplace lists no salons and the
-- add-on page says the database update is missing. Booking links (/book/<slug>) keep working either way.
--
-- Salon, service, staff, business-hour, location and photo records are NOT copied: they stay in their
-- existing tables. The new tables hold only what exists for the Marketplace alone.

BEGIN;

CREATE TABLE IF NOT EXISTS marketplace_onboarding (
    salon_id                 uuid PRIMARY KEY REFERENCES salons(id) ON DELETE CASCADE,
    status                   varchar(20) NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    current_step             smallint NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 7),
    -- The owner's "Confirm Location". The coordinates are kept so that a later change to the saved
    -- location counts as unconfirmed.
    location_place_id        text,
    location_confirmed_at    timestamptz,
    confirmed_latitude       numeric(10, 7),
    confirmed_longitude      numeric(10, 7),
    -- Active staff the owner chose not to show on the Marketplace.
    hidden_staff_ids         uuid[] NOT NULL DEFAULT '{}',
    bookings_enabled         boolean NOT NULL DEFAULT true,
    services_saved_at        timestamptz,
    availability_saved_at    timestamptz,
    preferences_saved_at     timestamptz,
    terms_accepted_at        timestamptz,
    terms_accepted_by        uuid,
    submitted_at             timestamptz,
    reviewed_at              timestamptz,
    reviewed_by              uuid,
    rejection_reason         text,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_onboarding_status ON marketplace_onboarding (status);

-- A row exists only for a service the owner changed. No row = shown, at the catalog price.
CREATE TABLE IF NOT EXISTS marketplace_service_settings (
    salon_id       uuid NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
    service_id     uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    is_listed      boolean NOT NULL DEFAULT true,
    display_price  numeric(10, 2) CHECK (display_price IS NULL OR display_price >= 0),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (salon_id, service_id)
);

ALTER TABLE marketplace_images
    ADD COLUMN IF NOT EXISTS category varchar(20)
    CHECK (category IS NULL OR category IN ('interior', 'exterior', 'portfolio', 'team'));

-- Marks appointments booked through the Marketplace. `source` is left as it is, so existing reports don't change.
ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS via_marketplace boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_appointments_via_marketplace
    ON appointments (salon_id, scheduled_at) WHERE via_marketplace;

COMMIT;
