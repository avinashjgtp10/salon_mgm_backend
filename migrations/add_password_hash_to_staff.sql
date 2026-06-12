-- Migration: add password_hash column to staff table
-- Run this once against your PostgreSQL database

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS password_hash TEXT;
