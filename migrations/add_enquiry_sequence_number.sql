ALTER TABLE salons ADD COLUMN IF NOT EXISTS next_enquiry_seq INTEGER NOT NULL DEFAULT 1;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS enquiry_no INTEGER;

-- Backfill any existing rows with a per-salon sequential number, oldest first.
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY salon_id ORDER BY created_at) AS rn
  FROM enquiries
  WHERE enquiry_no IS NULL
)
UPDATE enquiries e SET enquiry_no = numbered.rn
FROM numbered
WHERE numbered.id = e.id;

-- Advance each salon's counter past any backfilled numbers so new
-- enquiries never collide with one just assigned above.
UPDATE salons s SET next_enquiry_seq = GREATEST(s.next_enquiry_seq, sub.max_no + 1)
FROM (SELECT salon_id, MAX(enquiry_no) AS max_no FROM enquiries GROUP BY salon_id) sub
WHERE sub.salon_id = s.id;

ALTER TABLE enquiries ALTER COLUMN enquiry_no SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS enquiries_salon_id_enquiry_no_key
  ON enquiries (salon_id, enquiry_no);
