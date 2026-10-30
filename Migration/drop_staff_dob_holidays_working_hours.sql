-- Removes the staff Date of Birth, Holidays and Working Hours/Day fields.
-- The application no longer reads or writes these columns.
--
-- RUN ORDER: deploy the backend code first, run this afterwards. Run it before
-- the code is live and the old INSERT/UPDATE statements would hit a missing
-- column.
--
-- Destructive: the stored values are lost. Take a backup first if anyone might
-- want the staff birthdays back. Client birthdays (clients.birthday_day_month)
-- are a different column and are not touched.

ALTER TABLE staff
  DROP COLUMN IF EXISTS birthday_day,
  DROP COLUMN IF EXISTS birthday_month,
  DROP COLUMN IF EXISTS birthday_year,
  DROP COLUMN IF EXISTS holidays,
  DROP COLUMN IF EXISTS working_hours_per_day;
