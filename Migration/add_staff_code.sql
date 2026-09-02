-- Per-salon auto-generated Staff Code (e.g. STF-00001), same pattern as
-- next_invoice_seq/next_enquiry_seq/next_purchase_seq. Safe to re-run.

ALTER TABLE salons ADD COLUMN IF NOT EXISTS next_staff_seq INT NOT NULL DEFAULT 1;
ALTER TABLE staff  ADD COLUMN IF NOT EXISTS staff_code VARCHAR(20);

-- Backfill existing staff, ordered by creation so codes stay chronological.
-- Runs per salon so each salon's sequence starts independently at STF-00001.
-- Only touches rows that don't already have a code, and only ever raises
-- (never lowers) next_staff_seq, so re-running this after new staff have
-- already been created with real codes is a safe no-op.
DO $$
DECLARE
  s RECORD;
  st RECORD;
  seq INT;
BEGIN
  FOR s IN SELECT id FROM salons LOOP
    SELECT COALESCE(MAX(
      CASE WHEN staff_code ~ '^STF-\d+$'
        THEN substring(staff_code from 5)::int
        ELSE 0
      END
    ), 0) + 1 INTO seq
    FROM staff WHERE salon_id = s.id;

    FOR st IN
      SELECT id FROM staff
      WHERE salon_id = s.id AND staff_code IS NULL
      ORDER BY created_at ASC
    LOOP
      UPDATE staff SET staff_code = 'STF-' || LPAD(seq::text, 5, '0') WHERE id = st.id;
      seq := seq + 1;
    END LOOP;

    UPDATE salons SET next_staff_seq = GREATEST(next_staff_seq, seq) WHERE id = s.id;
  END LOOP;
END $$;

ALTER TABLE staff ALTER COLUMN staff_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_staff_code_salon_uq ON staff (salon_id, staff_code);
