-- SCRUM-1084: Anniversary date on client profiles. A full date (unlike
-- birthday, which is split into day-month + optional year), so a single DATE
-- column is enough. Nullable — optional on Add/Edit.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS anniversary DATE;
