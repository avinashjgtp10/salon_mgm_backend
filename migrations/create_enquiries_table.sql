CREATE TABLE IF NOT EXISTS enquiries (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id    UUID        NOT NULL REFERENCES salons(id)    ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  phone       TEXT        NOT NULL,
  service_id  UUID        REFERENCES services(id) ON DELETE SET NULL,
  staff_id    UUID        REFERENCES staff(id)    ON DELETE SET NULL,
  status      TEXT        NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Follow-up', 'Converted', 'Closed')),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enquiries_salon_id ON enquiries (salon_id);
CREATE INDEX IF NOT EXISTS idx_enquiries_status    ON enquiries (salon_id, status);
CREATE INDEX IF NOT EXISTS idx_enquiries_created_at ON enquiries (salon_id, created_at DESC);
