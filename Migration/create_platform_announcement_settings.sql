-- Super Admin > Client Announcements runs the normal Marketing module (templates, campaigns, inbox, insights) against ONE
-- "platform salon": a regular salon that holds SalonOx's own Meta WhatsApp account (connected the usual way, Super Admin >
-- Salons > the salon > WhatsApp). Its clients are the salon owners (synced from Client Announcements).
-- This table just remembers which salon that is. One row. Run once per environment.

CREATE TABLE IF NOT EXISTS platform_announcement_settings (
  id         BOOLEAN     PRIMARY KEY DEFAULT TRUE CHECK (id),   -- the CHECK keeps this a single-row table
  salon_id   TEXT        NOT NULL,
  updated_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
