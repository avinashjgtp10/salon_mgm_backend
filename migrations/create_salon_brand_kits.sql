-- Brand Kit — the salon's colours, fonts, logo and social handles, used to
-- auto-fill coupon designs.
--
-- A separate 1:1 table rather than more columns on `salons`: that table is
-- already wide and touched by nearly every query, the brand kit is optional,
-- and this is one safe additive migration instead of a dozen ALTERs on the
-- hottest table in the schema.
--
-- Note `salons` already has business_name, logo_url, phone, website_url and
-- address — those are NOT duplicated here. The brand kit only holds what has
-- no home today: colours, font choices, socials and a tagline. The API merges
-- the two when it answers.
--
-- Read-only from the API as of 2026-08-10 — there is no editor UI (the
-- designer's Brand panel was removed), only GET /api/v1/brand-kit, which
-- CouponDesignerPage.tsx uses to resolve {{Tagline}}/{{Instagram}}/etc tokens.
-- Values can currently only be set by writing directly into this table.

CREATE TABLE IF NOT EXISTS salon_brand_kits (
  salon_id         UUID PRIMARY KEY REFERENCES salons(id) ON DELETE CASCADE,
  primary_color    VARCHAR(9),
  secondary_color  VARCHAR(9),
  accent_color     VARCHAR(9),
  text_color       VARCHAR(9),
  heading_font     VARCHAR(80),
  body_font        VARCHAR(80),
  -- Own logo field: salons.logo_url has no working uploader today, and a
  -- salon may want a different mark on marketing artwork than on invoices.
  logo_url         TEXT,
  instagram        VARCHAR(120),
  facebook         VARCHAR(120),
  whatsapp_number  VARCHAR(32),
  tagline          VARCHAR(160),
  extras           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
