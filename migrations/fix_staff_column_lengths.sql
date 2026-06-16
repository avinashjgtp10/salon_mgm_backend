-- Fix staff columns that are too narrow for real-world data.
-- designation (job_title) was VARCHAR(10) — "Hair Dresser" (12 chars) overflows it.
-- phone was likely VARCHAR(10) — international numbers can be 15+ digits.
-- calendar_color was VARCHAR(10) — "light_blue" is exactly 10, any future value could overflow.

ALTER TABLE staff
    ALTER COLUMN designation    TYPE VARCHAR(255),
    ALTER COLUMN phone          TYPE VARCHAR(30),
    ALTER COLUMN calendar_color TYPE VARCHAR(30);

