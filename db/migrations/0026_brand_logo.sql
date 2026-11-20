-- 0026_brand_logo.sql — the clinic's logo, apart from the bill header.
--
-- Append-only: never edit once applied.
--
-- logo_url is the letterhead band printed across the top of every bill.
-- brand_logo_url is the clinic's logo on its own, shown on the sign-in screen.
-- Both are downscaled data URLs, like logo_url always was.
ALTER TABLE company ADD COLUMN brand_logo_url TEXT;
