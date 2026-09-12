-- Calendar permissions rename ticket: clarifies what create_appointment and
-- edit_appointment actually control, and moves the "record payment on an
-- appointment" ability from create_appointment to edit_appointment — it was
-- previously bundled into create_appointment (see its old description:
-- "...and open the payment flow to record a payment on an appointment"),
-- which meant a staff member who could only book appointments could also
-- take payments, and vice versa a staff member who could edit/reschedule
-- had no say in payment at all. Now split cleanly:
--   - create_appointment ("Create Booking Appointment"): booking only, no
--     payment ability.
--   - edit_appointment ("Edit & Payment Appointment"): editing an existing
--     appointment AND recording/collecting payment on it.
-- (Enforcement side: appointments.routes.ts's POST /:id/checkout now
-- requires edit_appointment instead of create_appointment; AppointmentModal.tsx
-- and ViewBillModal.tsx's payment buttons updated to match.)
--
-- Per project policy this file is created but NOT auto-run; apply it by
-- hand against each environment (dev/QA/prod) in that order.

BEGIN;

UPDATE permissions SET
  name = 'Create Booking Appointment',
  description = 'Create a new booking appointment — does not include payment'
WHERE key = 'create_appointment';

UPDATE permissions SET
  name = 'Edit & Payment Appointment',
  description = 'Edit an existing appointment and record/collect payment on it'
WHERE key = 'edit_appointment';

COMMIT;
