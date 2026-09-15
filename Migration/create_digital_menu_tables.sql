-- Digital Menu / QR Menu — customer-facing presentation layer over existing
-- Services. One menu per salon; no service data is duplicated here — the
-- public read path always joins live against `services`/`service_categories`.
--
-- This schema is also created automatically at boot via the idempotent
-- ensureTable() in src/modules/digital-menu/digital-menu.repository.ts (same
-- pattern as client_notes, client_memberships, payments, etc.), so local/dev
-- environments need no manual step. This file exists for environments where
-- boot-time DDL is disabled and to document the schema explicitly.
--
-- Per project policy this file is created but NOT auto-run; apply it by hand
-- against each environment if boot-time table creation is not desired there.

CREATE TABLE IF NOT EXISTS digital_menus (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id                UUID        NOT NULL UNIQUE,
  name                    VARCHAR(255) NOT NULL DEFAULT 'Main Menu',
  status                  VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  service_selection_mode  VARCHAR(20) NOT NULL DEFAULT 'all_active' CHECK (service_selection_mode IN ('all_active', 'specific')),
  public_token            VARCHAR(64) NOT NULL UNIQUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_digital_menus_token ON digital_menus(public_token);

-- Mapping table for "specific" mode selections — mirrors bundle_services /
-- service_staff. ON DELETE CASCADE means deleting a service automatically
-- removes it from every menu's selection with no cleanup step required.
CREATE TABLE IF NOT EXISTS digital_menu_services (
  menu_id    UUID NOT NULL REFERENCES digital_menus(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (menu_id, service_id)
);
