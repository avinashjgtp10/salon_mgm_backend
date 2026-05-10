-- Creates the blocked_times table for storing staff unavailability blocks

CREATE TABLE IF NOT EXISTS blocked_times (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id       UUID NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  staff_id       UUID NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  start_time     TIME NOT NULL,
  end_time       TIME NOT NULL,
  reason         TEXT,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT blocked_times_end_after_start CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_blocked_times_salon_date   ON blocked_times (salon_id, date);
CREATE INDEX IF NOT EXISTS idx_blocked_times_staff_date   ON blocked_times (staff_id, date);
CREATE INDEX IF NOT EXISTS idx_blocked_times_salon_staff  ON blocked_times (salon_id, staff_id);
