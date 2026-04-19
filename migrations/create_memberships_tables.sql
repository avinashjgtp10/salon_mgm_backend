-- You need this migration file
CREATE TABLE IF NOT EXISTS memberships (
  id                       UUID PRIMARY KEY,
  name                     VARCHAR(255) NOT NULL,
  description              TEXT,
  session_type             VARCHAR(50)  NOT NULL,
  number_of_sessions       INTEGER,
  valid_for                VARCHAR(50)  NOT NULL,
  price                    NUMERIC(10,2) NOT NULL,
  tax_rate                 NUMERIC(5,2),
  colour                   VARCHAR(50)  NOT NULL,
  enable_online_sales      BOOLEAN NOT NULL DEFAULT false,
  enable_online_redemption BOOLEAN NOT NULL DEFAULT true,
  terms_and_conditions     TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS membership_services (
  membership_id UUID REFERENCES memberships(id) ON DELETE CASCADE,
  service_id    UUID REFERENCES services(id)    ON DELETE CASCADE,
  PRIMARY KEY (membership_id, service_id)
);
