CREATE TYPE appointment_status AS ENUM (
    'booked', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'
);

CREATE TABLE IF NOT EXISTS appointments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    salon_id         UUID NOT NULL,
    client_id        UUID,
    staff_id         UUID,
    service_id       UUID,
    scheduled_at     TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    status           appointment_status NOT NULL DEFAULT 'booked',
    notes            TEXT,
    sale_id          UUID,
    created_by       UUID,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_appointments_salon_id     ON appointments (salon_id);
CREATE INDEX idx_appointments_client_id    ON appointments (client_id);
CREATE INDEX idx_appointments_staff_id     ON appointments (staff_id);
CREATE INDEX idx_appointments_scheduled_at ON appointments (scheduled_at);
CREATE INDEX idx_appointments_status       ON appointments (status);

CREATE INDEX idx_appointments_staff_active
    ON appointments (staff_id, scheduled_at)
    WHERE status NOT IN ('cancelled', 'no_show');
