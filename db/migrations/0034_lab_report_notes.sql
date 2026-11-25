-- 0034_lab_report_notes.sql — two lines of text the lab sets once for every report.
--
-- Append-only: never edit once applied.
--
-- Owner, 2083-08-09 (Settings → Lab report):
--   page_note  printed at the foot of every page of every report
--   end_note   printed once, at the end of the report, after the last result
-- Typed by the lab; nothing is seeded (Rules §2.2).

ALTER TABLE lab_settings ADD COLUMN page_note TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_settings ADD COLUMN end_note TEXT NOT NULL DEFAULT '';
