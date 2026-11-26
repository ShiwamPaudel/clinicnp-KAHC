-- 0036_percent_discount_method.sql — how a bill discount typed as a
-- percentage becomes rupees.
--
-- Append-only: never edit once applied.
--
-- Owner, 2083-08-10 (Settings → Company → Bill discount):
--   of_subtotal  10% of the sub total (as it always was): 100 → discount 10
--   inclusive    the net plus the percentage makes the sub total:
--                x + 10% = 100 → x = 90.91, discount 9.09
-- The default keeps today's behaviour until someone switches it.

ALTER TABLE company ADD COLUMN percent_discount_method TEXT NOT NULL DEFAULT 'of_subtotal';
