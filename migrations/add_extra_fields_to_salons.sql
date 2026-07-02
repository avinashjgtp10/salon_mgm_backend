ALTER TABLE salons
  ADD COLUMN IF NOT EXISTS address           TEXT,
  ADD COLUMN IF NOT EXISTS city              TEXT,
  ADD COLUMN IF NOT EXISTS state             TEXT,
  ADD COLUMN IF NOT EXISTS country           TEXT,
  ADD COLUMN IF NOT EXISTS pincode           TEXT,
  ADD COLUMN IF NOT EXISTS timezone          TEXT DEFAULT 'Asia/Kolkata',
  ADD COLUMN IF NOT EXISTS currency          TEXT DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS business_category TEXT;
