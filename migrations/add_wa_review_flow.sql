ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS wa_message_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS staff_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_wa_message_id
  ON reviews (wa_message_id) WHERE wa_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_staff_id
  ON reviews (staff_id) WHERE staff_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS wa_review_prompts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id              UUID NOT NULL,
  client_id             UUID,
  phone                 VARCHAR(20) NOT NULL,
  appointment_id        UUID,
  staff_id              UUID,
  review_request_wamid  VARCHAR(100),
  opt_in_wamid          VARCHAR(100),
  list_prompt_wamid     VARCHAR(100),
  status                VARCHAR(20) NOT NULL DEFAULT 'PENDING_REPLY'
                           CHECK (status IN ('PENDING_REPLY', 'RATED', 'LIST_SEND_FAILED')),
  rating                SMALLINT CHECK (rating BETWEEN 1 AND 5),
  review_id             UUID REFERENCES reviews(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rated_at              TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_review_prompts_list_wamid
  ON wa_review_prompts (list_prompt_wamid) WHERE list_prompt_wamid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wa_review_prompts_phone_status
  ON wa_review_prompts (salon_id, phone, status);

CREATE INDEX IF NOT EXISTS idx_wa_review_prompts_staff
  ON wa_review_prompts (staff_id) WHERE staff_id IS NOT NULL;
