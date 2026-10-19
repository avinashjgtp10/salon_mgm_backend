-- salon_subscriptions is an unused duplicate of `subscriptions`: nothing in the backend reads or writes it
-- (only comments mention it) and it was empty. Run AFTER add_razorpay_to_subscription_plans.sql, which
-- repoints subscription_payments away from it. No CASCADE, so any unexpected dependency fails loudly.
DROP TABLE IF EXISTS salon_subscriptions;
