-- =============================================================================
-- Salon Management Backend — Complete Database Schema
-- Database: PostgreSQL
-- Convention: UUID PKs · snake_case names · TIMESTAMPTZ timestamps
-- Run order matters — tables are defined in FK-dependency order.
-- The sales ↔ appointments circular FK is resolved with ALTER TABLE at end.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- Shared trigger function — keeps updated_at current on every UPDATE
-- =============================================================================

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 1. USERS & AUTH
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  VARCHAR(255) NOT NULL UNIQUE,
  phone                  VARCHAR(50),
  password_hash          TEXT         NOT NULL DEFAULT '',
  first_name             VARCHAR(100) NOT NULL,
  last_name              VARCHAR(100),
  full_name              VARCHAR(255),
  role                   VARCHAR(50)  NOT NULL DEFAULT 'client'
                           CHECK (role IN ('superadmin','salon_owner','staff','client')),
  business_name          VARCHAR(255),
  address                TEXT,
  country                VARCHAR(100),
  country_code           VARCHAR(10),
  avatar_url             TEXT,
  is_verified            BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active              BOOLEAN      NOT NULL DEFAULT TRUE,
  is_onboarding_complete BOOLEAN      NOT NULL DEFAULT FALSE,
  last_login             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users (role);

-- ─── OAuth Identities ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_identities (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         VARCHAR(50)  NOT NULL,
  provider_user_id VARCHAR(255) NOT NULL,
  email            VARCHAR(255),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities (user_id);

-- ─── OTP Verifications ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS otp_verifications (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_code   TEXT        NOT NULL,
  purpose    VARCHAR(50) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  is_used    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_user_purpose ON otp_verifications (user_id, purpose);

-- ─── Refresh Tokens ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);

-- =============================================================================
-- 2. SALONS & BRANCHES
-- =============================================================================

CREATE TABLE IF NOT EXISTS salons (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  business_name VARCHAR(255) NOT NULL,
  business_type VARCHAR(100),
  slug          VARCHAR(255) UNIQUE,
  description   TEXT,
  logo_url      TEXT,
  banner_url    TEXT,
  email         VARCHAR(255),
  phone         VARCHAR(50),
  website_url   TEXT,
  gst_number    VARCHAR(50),
  pan_number    VARCHAR(50),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_salons_updated_at
  BEFORE UPDATE ON salons
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_salons_owner ON salons (owner_id);
CREATE INDEX IF NOT EXISTS idx_salons_slug  ON salons (slug);

-- ─── Branches ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS branches (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id      UUID         NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255),
  city          VARCHAR(100) NOT NULL,
  state         VARCHAR(100) NOT NULL,
  pincode       VARCHAR(20)  NOT NULL,
  country       VARCHAR(100) NOT NULL DEFAULT 'India',
  latitude      NUMERIC(10,6),
  longitude     NUMERIC(10,6),
  phone         VARCHAR(50),
  email         VARCHAR(255),
  is_main       BOOLEAN      NOT NULL DEFAULT FALSE,
  opening_time  TIME,
  closing_time  TIME,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_branches_updated_at
  BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_branches_salon ON branches (salon_id);

-- ─── Branch Timings ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branch_timings (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    UUID        NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  day_of_week  INT         NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opening_time TIME        NOT NULL DEFAULT '00:00:00',
  closing_time TIME        NOT NULL DEFAULT '00:00:00',
  is_closed    BOOLEAN     NOT NULL DEFAULT FALSE,
  UNIQUE (branch_id, day_of_week)
);
CREATE INDEX IF NOT EXISTS idx_branch_timings_branch ON branch_timings (branch_id);

-- ─── Branch Holidays ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS branch_holidays (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id  UUID        NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  date       DATE        NOT NULL,
  name       VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_id, date)
);

-- =============================================================================
-- 3. STAFF
-- =============================================================================

CREATE TABLE IF NOT EXISTS staff (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id           UUID         NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  branch_id          UUID         REFERENCES branches(id) ON DELETE SET NULL,
  first_name         VARCHAR(100) NOT NULL,
  last_name          VARCHAR(100),
  email              VARCHAR(255) NOT NULL,
  phone              VARCHAR(50),
  phone_country_code VARCHAR(10),
  additional_phone   VARCHAR(50),
  country            VARCHAR(100),
  calendar_color     VARCHAR(50)  NOT NULL DEFAULT 'blue',
  designation        VARCHAR(100),
  staff_external_id  VARCHAR(100),
  employment_type    VARCHAR(50),
  employee_code      VARCHAR(50),
  experience_years   INT,
  specialization     TEXT[],
  commission_type    VARCHAR(50),
  commission_value   NUMERIC(10,2),
  joined_date        DATE,
  birthday_day       INT,
  birthday_month     INT,
  start_date_day     INT,
  start_date_month   INT,
  start_year         INT,
  end_date_day       INT,
  end_date_month     INT,
  end_year           INT,
  notes              TEXT,
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  invitation_status  VARCHAR(50)  NOT NULL DEFAULT 'pending'
                       CHECK (invitation_status IN ('pending','accepted','rejected')),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_staff_updated_at
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_staff_salon       ON staff (salon_id);
CREATE INDEX IF NOT EXISTS idx_staff_branch      ON staff (branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_salon_email ON staff (salon_id, email);

-- ─── Staff Addresses ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_addresses (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     UUID        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  address_name VARCHAR(100),
  address      TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_staff_addresses_updated_at
  BEFORE UPDATE ON staff_addresses
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_staff_addresses_staff ON staff_addresses (staff_id);

-- ─── Staff Emergency Contacts ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staff_emergency_contacts (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id           UUID         NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  full_name          VARCHAR(255) NOT NULL,
  relationship       VARCHAR(100),
  email              VARCHAR(255),
  phone_country_code VARCHAR(10),
  phone_number       VARCHAR(50)  NOT NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_staff_emergency_contacts_updated_at
  BEFORE UPDATE ON staff_emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_staff_ec_staff ON staff_emergency_contacts (staff_id);

-- ─── Staff Leaves ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staff_leaves (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   UUID        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  start_date DATE        NOT NULL,
  end_date   DATE        NOT NULL,
  leave_type VARCHAR(50) NOT NULL,
  status     VARCHAR(50) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','rejected')),
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_leaves_dates_check CHECK (end_date >= start_date)
);

CREATE TRIGGER trg_staff_leaves_updated_at
  BEFORE UPDATE ON staff_leaves
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_staff_leaves_staff ON staff_leaves (staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_leaves_dates ON staff_leaves (start_date, end_date);

-- ─── Staff Invitations ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS staff_invitations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   UUID        NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  staff_id   UUID        NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  invited_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  token      TEXT        NOT NULL UNIQUE,
  status     VARCHAR(50) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','accepted','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_invitations_token ON staff_invitations (token);

-- =============================================================================
-- 4. SERVICE CATEGORIES & SERVICES
-- =============================================================================

CREATE TABLE IF NOT EXISTS service_categories (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id      UUID         NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  display_order INT          NOT NULL DEFAULT 0,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_service_categories_updated_at
  BEFORE UPDATE ON service_categories
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_service_categories_salon ON service_categories (salon_id);

-- ─── Services ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS services (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                      UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  category_id        UUID          NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
  name               VARCHAR(255)  NOT NULL,
  treatment_type     VARCHAR(100),
  description        TEXT,
  price_type         VARCHAR(50)   NOT NULL DEFAULT 'fixed'
                       CHECK (price_type IN ('fixed','from','free')),
  price              NUMERIC(10,2) NOT NULL DEFAULT 0,
  duration_minutes   INT           NOT NULL DEFAULT 60,
  online_booking     BOOLEAN       NOT NULL DEFAULT TRUE,
  commission_enabled BOOLEAN       NOT NULL DEFAULT FALSE,
  resource_required  BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active          BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_services_category ON services (category_id);

-- ─── Service↔Staff Junction ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_staff (
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  staff_id   UUID NOT NULL REFERENCES staff(id)   ON DELETE CASCADE,
  PRIMARY KEY (service_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_service_staff_staff ON service_staff (staff_id);

-- ─── Service Add-On Groups ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_add_on_groups (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                      UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  service_id          UUID         NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  name                VARCHAR(255) NOT NULL,
  prompt_to_client    VARCHAR(255) NOT NULL DEFAULT 'Select an option',
  min_quantity        INT,
  max_quantity        INT,
  allow_multiple_same BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_service_add_on_groups_updated_at
  BEFORE UPDATE ON service_add_on_groups
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_sag_service ON service_add_on_groups (service_id);

-- ─── Service Add-On Options ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS service_add_on_options (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                      UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  add_on_group_id     UUID          NOT NULL REFERENCES service_add_on_groups(id) ON DELETE CASCADE,
  name                VARCHAR(255)  NOT NULL,
  description         TEXT,
  additional_price    NUMERIC(10,2) NOT NULL DEFAULT 0,
  additional_duration INT           NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_service_add_on_options_updated_at
  BEFORE UPDATE ON service_add_on_options
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─── Bundles ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bundles (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                      UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  category_id        UUID          REFERENCES service_categories(id) ON DELETE SET NULL,
  name               VARCHAR(255)  NOT NULL,
  description        TEXT,
  schedule_type      VARCHAR(50)   NOT NULL DEFAULT 'sequence'
                       CHECK (schedule_type IN ('sequence','simultaneous')),
  price_type         VARCHAR(50)   NOT NULL DEFAULT 'service_pricing'
                       CHECK (price_type IN ('service_pricing','fixed')),
  retail_price       NUMERIC(10,2) NOT NULL DEFAULT 0,
  online_booking     BOOLEAN       NOT NULL DEFAULT TRUE,
  commission_enabled BOOLEAN       NOT NULL DEFAULT FALSE,
  resource_required  BOOLEAN       NOT NULL DEFAULT FALSE,
  available_for      VARCHAR(50)   NOT NULL DEFAULT 'all',
  is_active          BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_bundles_updated_at
  BEFORE UPDATE ON bundles
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─── Bundle↔Service Junction ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bundle_services (
  bundle_id  UUID NOT NULL REFERENCES bundles(id)  ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  sort_order INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (bundle_id, service_id)
);

-- =============================================================================
-- 5. CLIENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS clients (
  id                            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                      UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  first_name                    VARCHAR(100)  NOT NULL,
  last_name                     VARCHAR(100)  NOT NULL DEFAULT '',
  full_name                     VARCHAR(255)  NOT NULL,
  email                         VARCHAR(255),
  phone_country_code            VARCHAR(10),
  phone_number                  VARCHAR(50),
  additional_email              VARCHAR(255),
  additional_phone_country_code VARCHAR(10),
  additional_phone_number       VARCHAR(50),
  birthday_day_month            VARCHAR(10),
  birthday_year                 INT,
  gender                        VARCHAR(20),
  pronouns                      VARCHAR(50),
  client_source                 VARCHAR(50),
  referred_by_client_id         UUID          REFERENCES clients(id) ON DELETE SET NULL,
  preferred_language            VARCHAR(50),
  occupation                    VARCHAR(100),
  country                       VARCHAR(100),
  avatar_url                    TEXT,
  is_active                     BOOLEAN       NOT NULL DEFAULT TRUE,
  block_reason                  TEXT,
  total_sales                   NUMERIC(12,2) NOT NULL DEFAULT 0,
  email_notifications           BOOLEAN       NOT NULL DEFAULT TRUE,
  sms_notifications             BOOLEAN       NOT NULL DEFAULT TRUE,
  whatsapp_notifications        BOOLEAN       NOT NULL DEFAULT TRUE,
  email_marketing               BOOLEAN       NOT NULL DEFAULT FALSE,
  sms_marketing                 BOOLEAN       NOT NULL DEFAULT FALSE,
  whatsapp_marketing            BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at                    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_clients_email     ON clients (email);
CREATE INDEX IF NOT EXISTS idx_clients_phone     ON clients (phone_number);
CREATE INDEX IF NOT EXISTS idx_clients_full_name ON clients (full_name);
CREATE INDEX IF NOT EXISTS idx_clients_active    ON clients (is_active);

-- ─── Client Addresses ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_addresses (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type          VARCHAR(50) NOT NULL,
  address_name  VARCHAR(100),
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  apt_suite     VARCHAR(100),
  district      VARCHAR(100),
  city          VARCHAR(100),
  region        VARCHAR(100),
  postcode      VARCHAR(20),
  country       VARCHAR(100),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_addresses_client ON client_addresses (client_id);

-- ─── Client Emergency Contacts ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_emergency_contacts (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID         NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type               VARCHAR(50)  NOT NULL,
  full_name          VARCHAR(255) NOT NULL,
  relationship       VARCHAR(100),
  email              VARCHAR(255),
  phone_country_code VARCHAR(10),
  phone_number       VARCHAR(50),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_ec_client ON client_emergency_contacts (client_id);

-- =============================================================================
-- 6. PACKAGES & MEMBERSHIPS
-- =============================================================================

CREATE TABLE IF NOT EXISTS packages (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                      UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name             VARCHAR(255)  NOT NULL,
  slug             VARCHAR(255)  NOT NULL UNIQUE,
  description      TEXT,
  base_price       NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_value   NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_type    VARCHAR(50)   NOT NULL DEFAULT 'percentage'
                     CHECK (discount_type IN ('percentage','fixed')),
  duration_minutes INT           NOT NULL DEFAULT 0,
  category         VARCHAR(100),
  priority         INT           NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_packages_updated_at
  BEFORE UPDATE ON packages
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─── Package↔Service Junction ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS package_services (
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (package_id, service_id)
);

-- ─── Package Offers ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS package_offers (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      UUID          NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  offer_name      VARCHAR(255)  NOT NULL,
  coupon_code     VARCHAR(100)  NOT NULL UNIQUE,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_type   VARCHAR(50)   NOT NULL DEFAULT 'percentage'
                    CHECK (discount_type IN ('percentage','fixed')),
  start_date      DATE,
  end_date        DATE,
  minimum_order   NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_package_offers_updated_at
  BEFORE UPDATE ON package_offers
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─── Memberships ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memberships (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                      UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name                     VARCHAR(255)  NOT NULL,
  description              TEXT,
  session_type             VARCHAR(50)   NOT NULL
                             CHECK (session_type IN ('limited','unlimited')),
  number_of_sessions       INT,
  valid_for                VARCHAR(100)  NOT NULL,
  price                    NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_rate                 NUMERIC(5,2),
  colour                   VARCHAR(50),
  enable_online_sales      BOOLEAN       NOT NULL DEFAULT TRUE,
  enable_online_redemption BOOLEAN       NOT NULL DEFAULT TRUE,
  terms_and_conditions     TEXT,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_memberships_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─── Membership↔Service Junction ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS membership_services (
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  service_id    UUID NOT NULL REFERENCES services(id)   ON DELETE CASCADE,
  PRIMARY KEY (membership_id, service_id)
);

-- =============================================================================
-- 7. PRODUCTS & INVENTORY
-- =============================================================================

CREATE TABLE IF NOT EXISTS product_brands (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                      UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_product_brands_updated_at
  BEFORE UPDATE ON product_brands
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─── Products ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS products (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                      UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name                    VARCHAR(255)  NOT NULL,
  barcode                 VARCHAR(100),
  brand_id                UUID          REFERENCES product_brands(id)      ON DELETE SET NULL,
  category_id             UUID          REFERENCES service_categories(id)  ON DELETE SET NULL,
  measure_unit            VARCHAR(50),
  amount                  NUMERIC(10,2),
  short_description       VARCHAR(500),
  description             TEXT,
  supply_price            NUMERIC(10,2) NOT NULL DEFAULT 0,
  retail_sales_enabled    BOOLEAN       NOT NULL DEFAULT FALSE,
  retail_price            NUMERIC(10,2) NOT NULL DEFAULT 0,
  markup_percentage       NUMERIC(5,2),
  tax_type                VARCHAR(50),
  custom_tax_rate         NUMERIC(5,2),
  team_commission_enabled BOOLEAN       NOT NULL DEFAULT FALSE,
  team_commission_rate    NUMERIC(5,2),
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_products_barcode  ON products (barcode);
CREATE INDEX IF NOT EXISTS idx_products_brand    ON products (brand_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id);

-- ─── Suppliers ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS suppliers (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                      UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name                   VARCHAR(255) NOT NULL,
  description            TEXT,
  first_name             VARCHAR(100),
  last_name              VARCHAR(100),
  mobile_country_code    VARCHAR(10),
  mobile_number          VARCHAR(50),
  telephone_country_code VARCHAR(10),
  telephone_number       VARCHAR(50),
  email                  VARCHAR(255),
  website                TEXT,
  street                 VARCHAR(255),
  suburb                 VARCHAR(100),
  city                   VARCHAR(100),
  state                  VARCHAR(100),
  zip_code               VARCHAR(20),
  country                VARCHAR(100),
  same_as_physical       BOOLEAN      NOT NULL DEFAULT TRUE,
  postal_street          VARCHAR(255),
  postal_suburb          VARCHAR(100),
  postal_city            VARCHAR(100),
  postal_state           VARCHAR(100),
  postal_zip_code        VARCHAR(20),
  postal_country         VARCHAR(100),
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─── Stock Movements ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stock_movements (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                      UUID          NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  product_id       UUID          NOT NULL REFERENCES products(id)   ON DELETE CASCADE,
  movement_type    VARCHAR(50)   NOT NULL
                     CHECK (movement_type IN ('in','out','adjustment')),
  quantity         NUMERIC(10,2) NOT NULL,
  unit_cost        NUMERIC(10,2),
  supplier_id      UUID          REFERENCES suppliers(id) ON DELETE SET NULL,
  reference_number VARCHAR(100),
  notes            TEXT,
  created_by       UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product  ON stock_movements (product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_supplier ON stock_movements (supplier_id);

-- =============================================================================
-- 8. SALES  (created before appointments to resolve circular FK)
-- =============================================================================

CREATE TABLE IF NOT EXISTS sales (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id          UUID          NOT NULL REFERENCES salons(id)  ON DELETE RESTRICT,
  client_id         UUID          REFERENCES clients(id)          ON DELETE SET NULL,
  appointment_id    UUID,                        -- FK added via ALTER TABLE after appointments
  staff_id          UUID          REFERENCES staff(id)            ON DELETE SET NULL,
  status            VARCHAR(50)   NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','completed','refunded','cancelled')),
  subtotal          NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  tip_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method    VARCHAR(100),
  payment_reference VARCHAR(255),
  notes             TEXT,
  invoice_number    VARCHAR(100)  UNIQUE,
  created_by        UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_sales_updated_at
  BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_sales_salon      ON sales (salon_id);
CREATE INDEX IF NOT EXISTS idx_sales_client     ON sales (client_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales (created_at DESC);

-- ─── Sale Items ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sale_items (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     UUID          NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  item_type   VARCHAR(50)   NOT NULL
                CHECK (item_type IN ('service','product','package','membership','quick')),
  item_id     UUID,
  name        VARCHAR(255)  NOT NULL,
  quantity    INT           NOT NULL DEFAULT 1,
  unit_price  NUMERIC(10,2) NOT NULL,
  total_price NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);

-- =============================================================================
-- 9. APPOINTMENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS appointments (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id         UUID          NOT NULL REFERENCES salons(id)   ON DELETE CASCADE,
  branch_id        UUID          REFERENCES branches(id)          ON DELETE SET NULL,
  client_id        UUID          REFERENCES clients(id)           ON DELETE SET NULL,
  staff_id         UUID          REFERENCES staff(id)             ON DELETE SET NULL,
  service_id       UUID          REFERENCES services(id)          ON DELETE SET NULL,
  sale_id          UUID          REFERENCES sales(id)             ON DELETE SET NULL,
  title            VARCHAR(255)  NOT NULL DEFAULT 'Appointment',
  notes            TEXT,
  status           VARCHAR(50)   NOT NULL DEFAULT 'booked'
                     CHECK (status IN ('booked','confirmed','in_progress','completed','cancelled','no_show')),
  payment_status   VARCHAR(50)   NOT NULL DEFAULT 'unpaid'
                     CHECK (payment_status IN ('unpaid','paid','partial','refunded')),
  scheduled_at     TIMESTAMPTZ   NOT NULL,
  duration_minutes INT           NOT NULL DEFAULT 60,
  ends_at          TIMESTAMPTZ   NOT NULL,
  colour           VARCHAR(50),
  created_by       UUID          REFERENCES users(id) ON DELETE SET NULL,
  services         JSONB         NOT NULL DEFAULT '[]',
  package_items    JSONB         NOT NULL DEFAULT '[]',
  product_items    JSONB         NOT NULL DEFAULT '[]',
  membership_items JSONB         NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_appointments_salon        ON appointments (salon_id);
CREATE INDEX IF NOT EXISTS idx_appointments_staff        ON appointments (staff_id);
CREATE INDEX IF NOT EXISTS idx_appointments_client       ON appointments (client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_scheduled_at ON appointments (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_salon_date   ON appointments (salon_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status       ON appointments (status);

-- ─── Resolve circular FK: sales.appointment_id → appointments ─────────────────

ALTER TABLE sales
  ADD CONSTRAINT fk_sales_appointment
  FOREIGN KEY (appointment_id)
  REFERENCES appointments(id)
  ON DELETE SET NULL;

-- ─── Blocked Times ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS blocked_times (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id   UUID        NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  staff_id   UUID        NOT NULL REFERENCES staff(id)  ON DELETE CASCADE,
  date       DATE        NOT NULL,
  start_time TIME        NOT NULL,
  end_time   TIME        NOT NULL,
  reason     TEXT,
  created_by UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT blocked_times_end_after_start CHECK (end_time > start_time)
);

CREATE TRIGGER trg_blocked_times_updated_at
  BEFORE UPDATE ON blocked_times
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_blocked_times_salon_date  ON blocked_times (salon_id, date);
CREATE INDEX IF NOT EXISTS idx_blocked_times_staff_date  ON blocked_times (staff_id, date);
CREATE INDEX IF NOT EXISTS idx_blocked_times_salon_staff ON blocked_times (salon_id, staff_id);

-- =============================================================================
-- 10. PAYMENTS
-- =============================================================================

CREATE TABLE IF NOT EXISTS payments (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      TEXT          UNIQUE,
  appointment_id  UUID          REFERENCES appointments(id) ON DELETE SET NULL,
  salon_id        UUID          NOT NULL REFERENCES salons(id)  ON DELETE RESTRICT,
  client_id       UUID          REFERENCES clients(id)          ON DELETE SET NULL,
  amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ewallet_used    NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
  due_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  coupon_code     VARCHAR(100),
  payment_method  VARCHAR(100)  NOT NULL,
  split_details   JSONB,
  status          VARCHAR(50)   NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('completed','partial','unpaid','refunded')),
  paid_at         TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_payments_appointment ON payments (appointment_id);
CREATE INDEX IF NOT EXISTS idx_payments_salon       ON payments (salon_id);
CREATE INDEX IF NOT EXISTS idx_payments_client      ON payments (client_id);

-- =============================================================================
-- 11. COUPONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS coupons (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id       UUID          REFERENCES salons(id) ON DELETE CASCADE,
  code           VARCHAR(100)  NOT NULL UNIQUE,
  discount_type  VARCHAR(50)   NOT NULL DEFAULT 'percentage'
                   CHECK (discount_type IN ('percentage','fixed')),
  discount_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  max_uses       INT,
  used_count     INT           NOT NULL DEFAULT 0,
  expires_at     TIMESTAMPTZ,
  is_active      BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_coupons_updated_at
  BEFORE UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_coupons_code    ON coupons (UPPER(code));
CREATE INDEX IF NOT EXISTS idx_coupons_salon   ON coupons (salon_id);
CREATE INDEX IF NOT EXISTS idx_coupons_expires ON coupons (expires_at);

-- =============================================================================
-- 12. BILLING
-- =============================================================================

CREATE TABLE IF NOT EXISTS billing_plans (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255)  NOT NULL,
  "interval"    VARCHAR(20)   NOT NULL DEFAULT 'monthly'
                  CHECK ("interval" IN ('monthly','yearly')),
  price_per_unit NUMERIC(10,2) NOT NULL DEFAULT 0,
  trial_days    INT           NOT NULL DEFAULT 0,
  features      JSONB         NOT NULL DEFAULT '{}',
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_billing_plans_updated_at
  BEFORE UPDATE ON billing_plans
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ─── Billing Subscriptions ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id             UUID          NOT NULL REFERENCES salons(id)        ON DELETE RESTRICT,
  plan_id              UUID          NOT NULL REFERENCES billing_plans(id) ON DELETE RESTRICT,
  status               VARCHAR(50)   NOT NULL DEFAULT 'trialing'
                         CHECK (status IN ('trialing','active','past_due','cancelled','expired')),
  quantity             INT           NOT NULL DEFAULT 1,
  unit_price           NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  current_period_start TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  current_period_end   TIMESTAMPTZ   NOT NULL,
  trial_ends_at        TIMESTAMPTZ,
  payment_method       VARCHAR(100),
  card_holder_name     VARCHAR(255),
  card_last4           VARCHAR(10),
  card_brand           VARCHAR(50),
  card_expiry          VARCHAR(10),
  account_type         VARCHAR(50),
  billing_first_name   VARCHAR(100),
  billing_last_name    VARCHAR(100),
  billing_address      TEXT,
  vat_number           VARCHAR(50),
  created_by           UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_billing_subscriptions_updated_at
  BEFORE UPDATE ON billing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_billing_subs_salon  ON billing_subscriptions (salon_id);
CREATE INDEX IF NOT EXISTS idx_billing_subs_status ON billing_subscriptions (status);

-- ─── Billing Invoices ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS billing_invoices (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID          NOT NULL REFERENCES billing_subscriptions(id) ON DELETE CASCADE,
  salon_id        UUID          NOT NULL REFERENCES salons(id) ON DELETE RESTRICT,
  amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  status          VARCHAR(50)   NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','failed','refunded')),
  invoice_number  VARCHAR(100)  UNIQUE,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_billing_invoices_updated_at
  BEFORE UPDATE ON billing_invoices
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_billing_invoices_salon ON billing_invoices (salon_id);
CREATE INDEX IF NOT EXISTS idx_billing_invoices_sub   ON billing_invoices (subscription_id);
