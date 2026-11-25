-- 0033_vitals_height.sql — height on the vitals row, and when the vitals were taken.
--
-- Append-only: never edit once applied.
--
-- Owner, 2083-08-09: record height with the other vitals, show BMI from height
-- and weight, and list each patient's vitals by date on their card so a new
-- reading can be compared with the last one. Still never validated or
-- interpreted (Rules §2.6): BMI is arithmetic, nothing more.
--
-- vitals_at is set whenever the vitals on a visit change, and cleared when
-- they are all emptied. Visits that already carry vitals take their last
-- update time, the nearest thing they recorded.

ALTER TABLE visits ADD COLUMN height_cm REAL;
ALTER TABLE visits ADD COLUMN vitals_at TEXT;

UPDATE visits
   SET vitals_at = updated_at
 WHERE vitals_at IS NULL
   AND (bp <> '' OR pulse IS NOT NULL OR temp_c IS NOT NULL OR weight_kg IS NOT NULL OR spo2 IS NOT NULL);
