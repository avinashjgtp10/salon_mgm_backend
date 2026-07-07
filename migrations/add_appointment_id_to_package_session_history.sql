ALTER TABLE client_package_session_history
  ADD COLUMN IF NOT EXISTS appointment_id UUID;
