-- 0027_lab_sendout.sql — tests sent to another laboratory, from Result entry.
--
-- Append-only: never edit once applied.
--
-- Every lab test billed goes to Sample collection, then Result entry. There,
-- each test is either done here (results entered, approved, reported) or sent
-- to another laboratory, which takes it straight to Reports (owner,
-- 2083-08-04). The old counter-side send-out (services.outsourced, a partner
-- picked at billing, the /sendout stages) is retired; its rows stay readable.
--
-- lab_results.status gains 'sent_out' (no CHECK, as 0024 explains).

-- One row per test sent. Cancelled (undone) rows are kept, never deleted: the
-- books read this table, and an undo is reversed on the day it happened.
CREATE TABLE IF NOT EXISTS lab_sendouts (
  id                 TEXT PRIMARY KEY,
  result_id          TEXT NOT NULL REFERENCES lab_results(id),
  order_id           TEXT NOT NULL REFERENCES lab_orders(id),
  test_id            TEXT NOT NULL REFERENCES lab_tests(id),
  test_name          TEXT NOT NULL,
  lab_partner_id     TEXT NOT NULL REFERENCES lab_partners(id),
  -- the bill line's own price when the test was billed on its own; 0 inside a
  -- profile (the profile's price cannot be split per test honestly)
  billed_paisa       INTEGER NOT NULL DEFAULT 0,
  sent_date_ad       TEXT NOT NULL,
  sent_date_bs       TEXT NOT NULL,
  sent_at            TEXT NOT NULL,
  sent_by            TEXT,
  sent_by_name       TEXT NOT NULL DEFAULT '',
  -- what the laboratory charges. NULL until its price list has a price; then
  -- filled once, dated the day it became known, so a closed year never moves.
  cost_paisa         INTEGER,
  charged_date_ad    TEXT,
  charged_date_bs    TEXT,
  cancelled_at       TEXT,
  cancelled_date_ad  TEXT,
  cancelled_date_bs  TEXT,
  cancelled_by_name  TEXT NOT NULL DEFAULT '',
  cancel_reason      TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_sendouts_partner ON lab_sendouts (lab_partner_id, charged_date_ad);
CREATE INDEX IF NOT EXISTS idx_lab_sendouts_result ON lab_sendouts (result_id);
CREATE INDEX IF NOT EXISTS idx_lab_sendouts_order ON lab_sendouts (order_id);

-- What each laboratory charges for each test. A row appears by itself the
-- first time a test is sent there, with no price, for the owner to fill in.
CREATE TABLE IF NOT EXISTS lab_partner_prices (
  lab_partner_id  TEXT NOT NULL REFERENCES lab_partners(id),
  test_id         TEXT NOT NULL REFERENCES lab_tests(id),
  cost_paisa      INTEGER,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (lab_partner_id, test_id)
);
