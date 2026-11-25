-- Staff > Payroll: settle the commission and tips of payroll periods that were ALREADY paid.
--
-- Why: paying a payroll period used to record the payment but leave that period's commission_earned / tip_earned rows as 'pending', so the
-- Commission and Tip tables kept showing "Pending" for money that had been paid. From now on the pay-salary step settles them itself, in the
-- same transaction as the payment (payroll.service.ts payStaff). This script fixes the periods paid BEFORE that change.
--
-- What it does: for every payroll_entries row with status = 'paid', every PENDING commission_earned / tip_earned row of that staff member whose
-- earned_at falls inside the entry's period (period_start .. period_end, inclusive) is marked 'paid'. That is the same date test the payroll
-- summary uses to pick a period's commission and tips, so exactly the rows that were paid are the ones settled.
-- It never touches rows outside a paid period, rows that are already 'paid' / 'cancelled', or any payroll data.
--
-- Not done on purpose: it does not create commission_settlements / tip_settlements history rows (the original payout dates and remaining
-- balances can't be reconstructed reliably), so the Commission and Tip tables become correct but the settlement history of past periods is
-- unchanged.
--
-- Safe to re-run: once a row is 'paid' it no longer matches. Run it with the same database time zone the app uses, because the period test is
-- earned_at::date (as it is in the app).
--
-- HOW TO RUN (dev -> QA -> prod):
--   1. Run STEP 1 on its own and check the numbers look right (read-only).
--   2. Run STEP 2. It is one transaction and prints how many rows and how much money it settled.

-- ───────────── STEP 1: preview (read-only) ─────────────
SELECT 'commission' AS earnings, COUNT(*) AS rows_to_settle, COALESCE(SUM(ce.commission_amount), 0) AS amount_to_settle
  FROM commission_earned ce
 WHERE ce.status = 'pending'
   AND EXISTS (SELECT 1 FROM payroll_entries pe
                WHERE pe.status = 'paid' AND pe.salon_id = ce.salon_id AND pe.staff_id = ce.staff_id
                  AND ce.earned_at::date BETWEEN pe.period_start AND pe.period_end)
UNION ALL
SELECT 'tips', COUNT(*), COALESCE(SUM(te.tip_amount), 0)
  FROM tip_earned te
 WHERE te.status = 'pending'
   AND EXISTS (SELECT 1 FROM payroll_entries pe
                WHERE pe.status = 'paid' AND pe.salon_id = te.salon_id AND pe.staff_id = te.staff_id
                  AND te.earned_at::date BETWEEN pe.period_start AND pe.period_end);

-- ───────────── STEP 2: apply ─────────────
BEGIN;

WITH fixed AS (
  UPDATE commission_earned ce
     SET status = 'paid',
         paid_at = COALESCE(
           (SELECT MAX(pe.payment_date)::timestamptz FROM payroll_entries pe
             WHERE pe.status = 'paid' AND pe.salon_id = ce.salon_id AND pe.staff_id = ce.staff_id
               AND ce.earned_at::date BETWEEN pe.period_start AND pe.period_end),
           NOW()),
         updated_at = NOW()
   WHERE ce.status = 'pending'
     AND EXISTS (SELECT 1 FROM payroll_entries pe
                  WHERE pe.status = 'paid' AND pe.salon_id = ce.salon_id AND pe.staff_id = ce.staff_id
                    AND ce.earned_at::date BETWEEN pe.period_start AND pe.period_end)
  RETURNING ce.commission_amount
)
SELECT 'commission settled' AS what, COUNT(*) AS rows_settled, COALESCE(SUM(commission_amount), 0) AS amount FROM fixed;

WITH fixed AS (
  UPDATE tip_earned te
     SET status = 'paid',
         paid_at = COALESCE(
           (SELECT MAX(pe.payment_date)::timestamptz FROM payroll_entries pe
             WHERE pe.status = 'paid' AND pe.salon_id = te.salon_id AND pe.staff_id = te.staff_id
               AND te.earned_at::date BETWEEN pe.period_start AND pe.period_end),
           NOW()),
         updated_at = NOW()
   WHERE te.status = 'pending'
     AND EXISTS (SELECT 1 FROM payroll_entries pe
                  WHERE pe.status = 'paid' AND pe.salon_id = te.salon_id AND pe.staff_id = te.staff_id
                    AND te.earned_at::date BETWEEN pe.period_start AND pe.period_end)
  RETURNING te.tip_amount
)
SELECT 'tips settled' AS what, COUNT(*) AS rows_settled, COALESCE(SUM(tip_amount), 0) AS amount FROM fixed;

COMMIT;
