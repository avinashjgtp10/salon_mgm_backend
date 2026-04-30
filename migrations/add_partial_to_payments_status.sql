-- Migration: add 'partial' to payments.status CHECK constraint
-- Run this once against your PostgreSQL database

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_status_check;

ALTER TABLE payments
  ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'partial', 'completed', 'failed', 'refunded'));
