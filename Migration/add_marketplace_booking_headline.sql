-- Online Booking page heading: the title + subtitle on the first step of the
-- public booking page, which used to be hardcoded for every salon
-- ("Your Next Look Awaits" / "Book your favourite services in a few simple steps.").
--
-- NULL = use those built-in defaults. Lengths mirror the limits enforced in
-- marketplace.validator.ts (60 / 140) and the settings card.
--
-- Until this runs, the public page keeps the default wording and saving a
-- custom heading returns a clear "not available yet" error.
--
-- Safe to re-run.

ALTER TABLE marketplace_profiles
  ADD COLUMN IF NOT EXISTS booking_headline    VARCHAR(60),
  ADD COLUMN IF NOT EXISTS booking_subheadline VARCHAR(140);
