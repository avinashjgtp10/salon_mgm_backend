-- Links each Basic/Advance/Pro tier to a real, checkout-capable Razorpay
-- plan. The actual working Razorpay checkout mechanism in this codebase
-- lives in modules/subscriptions (its own subscription_plans table, with a
-- razorpay_plan_id column and a createSubscription() that calls
-- razorpay.subscriptions.create()) — NOT billing_plans (no razorpay_plan_id
-- column at all) and NOT this table itself. Rather than duplicate that
-- machinery, salon_plan_definitions just points at the subscription_plans
-- row super admin creates for each tier via POST /salon-plans/definitions/:tier/sync-razorpay
-- (modules/salon-plans), so SubscriptionWall.tsx's "Pay & Continue" button
-- can call the existing POST /subscriptions endpoint with a real plan_id.
--
-- NULL until an admin runs the sync action for that tier — a plan with no
-- link yet shows "Contact support" instead of a broken payment button.

ALTER TABLE salon_plan_definitions
  ADD COLUMN IF NOT EXISTS linked_subscription_plan_id UUID REFERENCES subscription_plans(id);
