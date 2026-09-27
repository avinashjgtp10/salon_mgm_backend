-- Tracks when a "sent" (Ordered) order was moved into verification via the
-- "Confirm Order" button on OrderDetailPage.tsx — a purely presentational
-- gate for the Verify Order list (Orders page), not a new order status.
-- Nullable/additive; NULL means "not yet confirmed for verification".
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS verification_started_at TIMESTAMPTZ;
