-- Migration: add permission_level and allow_calendar_bookings to staff table
-- Run this once against your PostgreSQL database

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS permission_level VARCHAR(20) DEFAULT 'low';

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS allow_calendar_bookings BOOLEAN DEFAULT true;
