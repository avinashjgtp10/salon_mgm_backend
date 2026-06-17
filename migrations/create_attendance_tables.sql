-- Attendance settings per salon
CREATE TABLE IF NOT EXISTS attendance_settings (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                  UUID          NOT NULL UNIQUE REFERENCES salons(id) ON DELETE CASCADE,
  shift_start               TIME          NOT NULL DEFAULT '09:00',
  shift_end                 TIME          NOT NULL DEFAULT '18:00',
  grace_minutes             INTEGER       NOT NULL DEFAULT 15,
  min_full_day_hours        NUMERIC(4,2)  NOT NULL DEFAULT 7.0,
  min_half_day_hours        NUMERIC(4,2)  NOT NULL DEFAULT 3.5,
  attendance_bonus          NUMERIC(10,2) NOT NULL DEFAULT 0,
  commission_threshold_days INTEGER       NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Daily attendance records per staff
CREATE TABLE IF NOT EXISTS attendance (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id     UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  staff_id     UUID          NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  date         DATE          NOT NULL,
  status       TEXT          NOT NULL DEFAULT 'absent'
                 CHECK (status IN ('present', 'absent', 'half_day', 'late', 'on_leave')),
  check_in     TIMESTAMPTZ,
  check_out    TIMESTAMPTZ,
  hours_worked NUMERIC(5,2),
  source       TEXT          NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('manual', 'biometric', 'qr', 'gps', 'appointment')),
  note         TEXT,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (salon_id, staff_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_salon_date   ON attendance (salon_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_staff_date   ON attendance (staff_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_salon_month  ON attendance (salon_id, date_trunc('month', date));
