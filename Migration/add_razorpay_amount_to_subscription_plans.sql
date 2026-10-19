-- The amount (in rupees, GST included) that a plan's Razorpay plan actually charges.
--
-- subscription_plans.price is the price BEFORE GST (what Super Admin enters and the cards show as "+ 18% GST").
-- Razorpay plans are immutable, so the GST-inclusive amount is fixed when the Razorpay plan is created; keeping
-- it here lets the app tell when a stored Razorpay plan no longer matches the price + GST and must be re-created.
-- NULL = plan created before GST was added (re-created on its next save / resync).
--
-- Additive and re-runnable.

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS razorpay_amount NUMERIC(12,2);
