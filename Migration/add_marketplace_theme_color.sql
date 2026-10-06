-- Online Booking theme colour: the accent colour the salon picks in
-- Online Booking > Theme Colour, applied to the public booking page's buttons,
-- highlights and links.
--
-- NULL = no custom colour; the public page then uses its built-in default
-- (#1e4634). Stored as a 7-char "#rrggbb" hex string (validated in
-- marketplace.validator.ts, which also rejects colours too light to read as
-- text on the page's white background).
--
-- Until this runs, the public page just keeps its default colour and saving a
-- colour from the settings page returns a clear "not available yet" error.
--
-- Safe to re-run.

ALTER TABLE marketplace_profiles
  ADD COLUMN IF NOT EXISTS theme_color VARCHAR(7);
