-- Ensures at most one active billing subscription per salon.
-- Required by the ON CONFLICT (salon_id) WHERE status = 'active' clauses in subscriptions.service.ts.
CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_salon_id_active_uniq
    ON billing_subscriptions (salon_id)
    WHERE status = 'active';
