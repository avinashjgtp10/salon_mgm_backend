-- ============================================================
-- Packages Module — Database Migration
-- Run this against your PostgreSQL database once.
-- ============================================================

-- 1. Core packages table
CREATE TABLE IF NOT EXISTS packages (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(255) NOT NULL,
  slug             VARCHAR(255) NOT NULL,
  description      TEXT,
  base_price       NUMERIC(10, 2) NOT NULL DEFAULT 0,
  discount_value   NUMERIC(10, 2) NOT NULL DEFAULT 0,
  discount_type    VARCHAR(20)  NOT NULL DEFAULT 'percentage'
                   CHECK (discount_type IN ('percentage', 'fixed')),
  duration_minutes INT          NOT NULL DEFAULT 0,
  category         VARCHAR(100) NOT NULL,
  priority         INT          NOT NULL DEFAULT 5,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2. Junction table: packages ↔ services
CREATE TABLE IF NOT EXISTS package_services (
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  service_id UUID NOT NULL,
  PRIMARY KEY (package_id, service_id)
);

-- 3. Package offers (coupons / discounts)
CREATE TABLE IF NOT EXISTS package_offers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      UUID        NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  offer_name      VARCHAR(255) NOT NULL DEFAULT '',
  coupon_code     VARCHAR(100) NOT NULL DEFAULT '',
  discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  discount_type   VARCHAR(20)  NOT NULL DEFAULT 'percentage'
                  CHECK (discount_type IN ('percentage', 'fixed')),
  start_date      DATE,
  end_date        DATE,
  minimum_order   NUMERIC(10, 2) NOT NULL DEFAULT 0,
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 4. Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_packages_category    ON packages(category);
CREATE INDEX IF NOT EXISTS idx_packages_slug        ON packages(slug);
CREATE INDEX IF NOT EXISTS idx_packages_created_at  ON packages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_package_services_pkg ON package_services(package_id);
CREATE INDEX IF NOT EXISTS idx_package_offers_pkg   ON package_offers(package_id);

-- 5. Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_packages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_packages_updated_at ON packages;
CREATE TRIGGER trg_packages_updated_at
  BEFORE UPDATE ON packages
  FOR EACH ROW EXECUTE FUNCTION update_packages_updated_at();
