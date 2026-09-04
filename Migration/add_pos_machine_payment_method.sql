-- Extends sales_payment_method_check to allow 'pos_machine' — without this,
-- every Payment Machine (POS terminal) payment succeeds (payments.payment_method
-- has no such constraint) but its matching sales/invoice row silently fails to
-- insert (caught non-fatally in payments.service.ts), leaving the appointment
-- marked PAID with no invoice number. See payment-method.util.ts's
-- resolveMoneyMethod(), which now maps the "Payment Machine" label to this value.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand
-- against each environment.

ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IN ('cash','card','gift_card','split','upi','wallet','package','membership','pos_machine'));
