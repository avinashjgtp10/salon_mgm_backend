-- Distinguishes a Quick Sale checkout (book + pay in one step, via
-- QuickSalePage.tsx's AppointmentModal quickSale={true}) from a real advance
-- Calendar booking. Both currently create an identical appointments row with
-- no way to tell them apart, which meant Quick Sale always fired the same
-- WhatsApp messages as Calendar (appointment_confirmation + payment_received),
-- even though there's no real "future visit" to confirm for a walk-in.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'calendar';

ALTER TABLE appointments
  ADD CONSTRAINT appointments_source_check CHECK (source IN ('calendar', 'quick_sale'));
