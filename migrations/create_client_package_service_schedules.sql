-- Migration: create client_package_service_schedules
--
-- Links one reserved session of a client_package_services line to a specific
-- future appointment, so a package service can be scheduled at sale time and
-- only redeemed (client_package_services.completed_sessions incremented) once
-- that exact appointment is actually completed -- not when it's merely
-- booked. Status lives here rather than on client_package_services because
-- one service line (total_sessions) can have several sessions independently
-- scheduled at different times; "Not Scheduled"/"Expired" are derived at read
-- time in client-packages.repository.ts, never stored.
--
-- UNIQUE(appointment_id): an appointment created by this feature always
-- represents exactly one package-service unit, never more than one --
-- guards against a retried "sell package" call double-linking.
--
-- NOT run automatically.

CREATE TABLE IF NOT EXISTS client_package_service_schedules (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_package_id           UUID        NOT NULL REFERENCES client_packages(id) ON DELETE CASCADE,
  client_package_service_id   UUID        NOT NULL REFERENCES client_package_services(id) ON DELETE CASCADE,
  appointment_id              UUID        NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  staff_id                    UUID        REFERENCES staff(id) ON DELETE SET NULL,
  status                      TEXT        NOT NULL DEFAULT 'Scheduled',
  scheduled_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_cpss_client_package_service
  ON client_package_service_schedules (client_package_service_id);

CREATE INDEX IF NOT EXISTS idx_cpss_appointment
  ON client_package_service_schedules (appointment_id);
