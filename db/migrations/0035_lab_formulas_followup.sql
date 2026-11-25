-- 0035_lab_formulas_followup.sql — calculated lab results, default results,
-- and follow-up bookings.
--
-- Append-only: never edit once applied.
--
-- Owner, 2083-08-09:
--   formula        a numeric test or value worked out from others, e.g.
--                  "{chol} / {hdl}" (lib/lab-formula.ts). Result entry fills
--                  it as the inputs are typed; it stays editable. '' = typed.
--   decimals       how many decimals a worked-out value is rounded to; NULL = 2
--   default_value  the result already in the box when entry starts
--                  (RA Factor "Negative", urine Colour "Light Yellow"). '' = none.
--   prebookings.is_followup
--                  a follow-up booked from the patient's page with no doctor;
--                  it may have no tests until they come.

ALTER TABLE lab_tests ADD COLUMN formula TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_tests ADD COLUMN decimals INTEGER;
ALTER TABLE lab_tests ADD COLUMN default_value TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_test_parameters ADD COLUMN formula TEXT NOT NULL DEFAULT '';
ALTER TABLE lab_test_parameters ADD COLUMN decimals INTEGER;
ALTER TABLE lab_test_parameters ADD COLUMN default_value TEXT NOT NULL DEFAULT '';
ALTER TABLE prebookings ADD COLUMN is_followup INTEGER NOT NULL DEFAULT 0;
