-- Apply before the matching backend deployment. Additive and safe to re-run.
BEGIN;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS attendance_breaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id UUID NOT NULL REFERENCES attendance(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL,
  planned_start TIMESTAMPTZ NOT NULL,
  planned_end TIMESTAMPTZ NOT NULL,
  actual_start TIMESTAMPTZ NOT NULL,
  actual_end TIMESTAMPTZ,
  note TEXT CHECK (length(note) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(attendance_id, request_id),
  CHECK (planned_end > planned_start),
  CHECK (actual_end IS NULL OR actual_end > actual_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_breaks_one_active ON attendance_breaks(attendance_id) WHERE actual_end IS NULL;
CREATE INDEX IF NOT EXISTS attendance_breaks_timeline ON attendance_breaks(attendance_id, actual_start);

-- Serialize all break writes on the parent attendance row. This also protects
-- against concurrent requests from older clients and administrative punch edits.
CREATE OR REPLACE FUNCTION guard_attendance_break() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE a attendance%ROWTYPE;
BEGIN
  SELECT * INTO a FROM attendance WHERE id = NEW.attendance_id FOR UPDATE;
  PERFORM id FROM staff WHERE id = a.staff_id FOR UPDATE;
  IF NEW.actual_end IS NULL AND EXISTS (
    SELECT 1 FROM attendance_breaks b JOIN attendance other ON other.id = b.attendance_id
    WHERE other.staff_id = a.staff_id AND other.salon_id = a.salon_id AND b.id <> NEW.id AND b.actual_end IS NULL
  ) THEN RAISE EXCEPTION 'Staff already has an active break'; END IF;
  IF a.check_in IS NULL OR a.check_out IS NOT NULL THEN RAISE EXCEPTION 'A break requires working attendance'; END IF;
  IF NEW.actual_start < a.check_in THEN RAISE EXCEPTION 'Break precedes check-in'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.attendance_id <> OLD.attendance_id OR NEW.actual_start <> OLD.actual_start OR NEW.planned_start <> OLD.planned_start OR NEW.planned_end <> OLD.planned_end OR NEW.request_id <> OLD.request_id OR NEW.note IS DISTINCT FROM OLD.note OR OLD.actual_end IS NOT NULL) THEN
    RAISE EXCEPTION 'Break history is immutable';
  END IF;
  IF a.scheduled_start IS NULL OR a.scheduled_end IS NULL OR NEW.planned_start < a.scheduled_start OR NEW.planned_end > a.scheduled_end OR NEW.actual_start < a.scheduled_start OR NEW.actual_start >= a.scheduled_end THEN
    RAISE EXCEPTION 'Break must be within the scheduled shift';
  END IF;
  IF EXISTS (SELECT 1 FROM attendance_breaks b WHERE b.attendance_id = NEW.attendance_id AND b.id <> NEW.id
    AND tstzrange(b.actual_start, b.actual_end, '[)') && tstzrange(NEW.actual_start, NEW.actual_end, '[)')) THEN
    RAISE EXCEPTION 'Overlapping attendance breaks';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS attendance_break_guard ON attendance_breaks;
CREATE TRIGGER attendance_break_guard BEFORE INSERT OR UPDATE ON attendance_breaks FOR EACH ROW EXECUTE FUNCTION guard_attendance_break();

-- Preserve session history through every legacy write path (manual, device,
-- appointment and edit), and keep the existing report column break-aware.
CREATE OR REPLACE FUNCTION guard_attendance_sessions() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE break_seconds NUMERIC;
BEGIN
  IF EXISTS (SELECT 1 FROM attendance_breaks WHERE attendance_id = OLD.id) THEN
    IF NEW.check_in IS DISTINCT FROM OLD.check_in OR NEW.staff_id <> OLD.staff_id OR NEW.salon_id <> OLD.salon_id OR NEW.date <> OLD.date
      OR NEW.scheduled_start IS DISTINCT FROM OLD.scheduled_start OR NEW.scheduled_end IS DISTINCT FROM OLD.scheduled_end THEN
      RAISE EXCEPTION 'Cannot rewrite attendance with break history';
    END IF;
    IF OLD.check_out IS NOT NULL AND NEW.check_out IS DISTINCT FROM OLD.check_out THEN RAISE EXCEPTION 'Attendance is already completed'; END IF;
    IF NEW.check_out IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM attendance_breaks WHERE attendance_id = OLD.id AND (actual_end IS NULL OR actual_end >= NEW.check_out)) THEN
        RAISE EXCEPTION 'Finish the break before final checkout';
      END IF;
      SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (actual_end - actual_start))), 0) INTO break_seconds FROM attendance_breaks WHERE attendance_id = OLD.id;
      NEW.hours_worked := ROUND((EXTRACT(EPOCH FROM (NEW.check_out - NEW.check_in)) - break_seconds) / 3600, 2);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS attendance_session_guard ON attendance;
CREATE TRIGGER attendance_session_guard BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION guard_attendance_sessions();
COMMIT;
