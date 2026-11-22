-- 0031_prebookings.sql — pre-booking tests and consultations, with advances.
--
-- Append-only: never edit once applied.
--
-- A patient rings the day before: "TFT, I'll come at 8 tomorrow." The front
-- desk books the name, phone and time, and the tests or services; when they
-- arrive the booking is issued as a bill. A doctor's consultation (an
-- appointments row) gets the same kind of booking when an advance is taken on
-- it or a bill is issued from it (owner, 2083-08-06).
--
-- Some pay something beforehand. That money is not income until the bill:
-- it is owed back to the patient, held in Advances from patients.
--   received  cash or QR in, Advances out       (advance_moves, kind 'received')
--   refunded  Advances in, cash or QR out       (kind 'refunded': cancelled,
--             missed, or more than the bill came to — handed back as change)
--   used      the bill is saved on dues for the part the advance covers, and
--             a dues payment of method 'advance' clears it (due_payments with
--             prebooking_id). Cancelling that bill undoes the dues payment, so
--             the advance is back on the booking to be refunded.
-- A booking's advance in hand = received − refunded − used (not undone).

CREATE TABLE IF NOT EXISTS prebookings (
  id              TEXT PRIMARY KEY,
  -- tests | consultation
  kind            TEXT NOT NULL,
  -- a consultation booking is the doctor's appointment, one each
  appointment_id  TEXT UNIQUE REFERENCES appointments(id),
  -- set once they are a registered patient (at booking, or when billed)
  patient_id      TEXT REFERENCES patients(id),
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL DEFAULT '',
  date_ad         TEXT NOT NULL,
  date_bs         TEXT NOT NULL,
  time_hhmm       TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  -- booked | billed | cancelled | missed
  status          TEXT NOT NULL DEFAULT 'booked',
  bill_id         TEXT REFERENCES bills(id),
  cancel_reason   TEXT NOT NULL DEFAULT '',
  booked_by       TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prebookings_day ON prebookings (date_ad, time_hhmm);
CREATE INDEX IF NOT EXISTS idx_prebookings_bill ON prebookings (bill_id);

-- what was booked: lab tests, profiles, packages or any other service
CREATE TABLE IF NOT EXISTS prebooking_items (
  id              TEXT PRIMARY KEY,
  prebooking_id   TEXT NOT NULL REFERENCES prebookings(id),
  service_id      TEXT NOT NULL REFERENCES services(id),
  name            TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_prebooking_items ON prebooking_items (prebooking_id, sort_order);

-- money in and out on a booking; never edited or deleted
CREATE TABLE IF NOT EXISTS advance_moves (
  id              TEXT PRIMARY KEY,
  prebooking_id   TEXT NOT NULL REFERENCES prebookings(id),
  -- received | refunded
  kind            TEXT NOT NULL,
  -- AR-000001 for money received, from counters 'advance_receipt_no'
  receipt_no      INTEGER UNIQUE,
  amount_paisa    INTEGER NOT NULL,
  -- cash | qr
  method          TEXT NOT NULL DEFAULT 'cash',
  -- the bill whose change it was, for an excess handed back at billing
  bill_id         TEXT REFERENCES bills(id),
  note            TEXT NOT NULL DEFAULT '',
  date_ad         TEXT NOT NULL,
  date_bs         TEXT NOT NULL,
  user_id         TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_advance_moves_booking ON advance_moves (prebooking_id);
CREATE INDEX IF NOT EXISTS idx_advance_moves_date ON advance_moves (date_ad);

ALTER TABLE due_payments ADD COLUMN prebooking_id TEXT REFERENCES prebookings(id);

INSERT OR IGNORE INTO counters (name, next_value) VALUES ('advance_receipt_no', 1);

INSERT OR IGNORE INTO accounts (id, code, name, kind, grp, segment, system_key, is_bank, is_control, auto_only, sort_order, created_at, updated_at) VALUES
  ('sys:patient_advances', '2040', 'Advances from patients', 'liability', 'current_liability', NULL, 'patient_advances', 0, 0, 1, 25,
   strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
