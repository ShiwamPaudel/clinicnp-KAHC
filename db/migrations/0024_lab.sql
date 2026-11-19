-- 0024_lab.sql — the in-house laboratory: what can be tested, and what
-- happens to a test from the bill to the signed report. See prod-docs/Lab.md.
--
-- Append-only: never edit once applied.
--
-- Nothing here holds money. A test or profile is billed through the service
-- row it owns (service_id), so its price lives on `services` with every other
-- price, and the counter, dues, returns and reports need to know nothing new.
--
-- Reference ranges are REAL, not integers: they are measurements, not money.
-- They are entered by the laboratory's own in-charge and copied onto each
-- result value at the moment it is entered (lab_result_values), so a report
-- always shows the range that was in force when it was validated.
--
-- No CHECK on any status column, for the reason written into 0013, 0015 and
-- 0016: this project has rebuilt tables to widen a CHECK more than once.

-- ============================================================
-- catalogue
-- ============================================================
CREATE TABLE IF NOT EXISTS lab_departments (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  -- Some sections never print a unit or a range (a stool exam reports "Ova /
  -- cyst not seen"). Switching a column off hides it for that section only.
  show_unit   INTEGER NOT NULL DEFAULT 1,
  show_range  INTEGER NOT NULL DEFAULT 1,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lab_sample_types (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- the tube or cap colour, as a hint on the collection screen and the label
  color_hex   TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lab_tests (
  id               TEXT PRIMARY KEY,
  -- the billable row; one test, one service
  service_id       TEXT NOT NULL UNIQUE REFERENCES services(id),
  name             TEXT NOT NULL,
  short_code       TEXT NOT NULL DEFAULT '',
  department_id    TEXT REFERENCES lab_departments(id),
  sample_type_id   TEXT REFERENCES lab_sample_types(id),
  method           TEXT NOT NULL DEFAULT '',
  -- printed under the test on the report (instrument, method statement)
  description      TEXT NOT NULL DEFAULT '',
  -- numeric | text | select | pos_neg | multi (multi = has parameters)
  result_type      TEXT NOT NULL DEFAULT 'numeric',
  -- for single-value tests; a multi test keeps these on its parameters
  unit             TEXT NOT NULL DEFAULT '',
  select_options   TEXT NOT NULL DEFAULT '[]',
  ref_text         TEXT NOT NULL DEFAULT '',
  ref_low          REAL,
  ref_high         REAL,
  critical_low     REAL,
  critical_high    REAL,
  -- [{ sex?: 'm'|'f', minAgeYears?, maxAgeYears?, low?, high?, text? }]
  ref_overrides    TEXT NOT NULL DEFAULT '[]',
  default_remarks  TEXT NOT NULL DEFAULT '',
  tat_hours        INTEGER,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_tests_dept ON lab_tests (department_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lab_tests_name ON lab_tests (name);

CREATE TABLE IF NOT EXISTS lab_test_parameters (
  id               TEXT PRIMARY KEY,
  test_id          TEXT NOT NULL REFERENCES lab_tests(id),
  name             TEXT NOT NULL,
  unit             TEXT NOT NULL DEFAULT '',
  -- numeric | text | select | pos_neg
  result_type      TEXT NOT NULL DEFAULT 'numeric',
  select_options   TEXT NOT NULL DEFAULT '[]',
  ref_text         TEXT NOT NULL DEFAULT '',
  ref_low          REAL,
  ref_high         REAL,
  critical_low     REAL,
  critical_high    REAL,
  ref_overrides    TEXT NOT NULL DEFAULT '[]',
  default_remarks  TEXT NOT NULL DEFAULT '',
  sort_order       INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_params_test ON lab_test_parameters (test_id, sort_order);

-- profiles / panels (CBC, LFT, Lipid profile)
CREATE TABLE IF NOT EXISTS lab_test_groups (
  id             TEXT PRIMARY KEY,
  service_id     TEXT NOT NULL UNIQUE REFERENCES services(id),
  name           TEXT NOT NULL,
  short_code     TEXT NOT NULL DEFAULT '',
  department_id  TEXT REFERENCES lab_departments(id),
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lab_test_group_items (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES lab_test_groups(id),
  test_id     TEXT NOT NULL REFERENCES lab_tests(id),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (group_id, test_id)
);

-- ============================================================
-- one order per bill that carries a lab test
-- ============================================================
CREATE TABLE IF NOT EXISTS lab_orders (
  id                    TEXT PRIMARY KEY,
  order_no              INTEGER NOT NULL UNIQUE,  -- lifetime, from counters 'lab_order_no'
  bill_id               TEXT NOT NULL UNIQUE REFERENCES bills(id),
  patient_id            TEXT NOT NULL REFERENCES patients(id),
  visit_id              TEXT REFERENCES visits(id),
  date_ad               TEXT NOT NULL,
  date_bs               TEXT NOT NULL,
  referred_by           TEXT NOT NULL DEFAULT '',
  priority              TEXT NOT NULL DEFAULT 'normal',   -- normal | urgent
  status                TEXT NOT NULL DEFAULT 'sample_pending',
  -- the short code on the bill's QR (/r/<token>)
  report_token          TEXT NOT NULL UNIQUE,
  -- the signature blocks the last approver chose, in print order (JSON ids)
  signatory_ids         TEXT NOT NULL DEFAULT '[]',
  -- set when the last test is approved and the bill is paid
  released_at           TEXT,
  view_count            INTEGER NOT NULL DEFAULT 0,
  last_viewed_at        TEXT,
  cancelled_at          TEXT,
  cancel_reason         TEXT NOT NULL DEFAULT '',
  created_by            TEXT NOT NULL REFERENCES users(id),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_orders_status ON lab_orders (status, created_at);
CREATE INDEX IF NOT EXISTS idx_lab_orders_patient ON lab_orders (patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lab_orders_date ON lab_orders (date_ad);

CREATE TABLE IF NOT EXISTS lab_order_tests (
  id                    TEXT PRIMARY KEY,
  order_id              TEXT NOT NULL REFERENCES lab_orders(id),
  bill_service_line_id  TEXT NOT NULL REFERENCES bill_service_lines(id),
  test_id               TEXT NOT NULL REFERENCES lab_tests(id),
  test_name             TEXT NOT NULL,         -- as billed
  department_id         TEXT,
  sample_type_id        TEXT,
  group_id              TEXT,
  group_name            TEXT NOT NULL DEFAULT '',
  -- ordered | sample_collected | result_draft | result_submitted |
  -- correction_required | approved | cancelled
  status                TEXT NOT NULL DEFAULT 'ordered',
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_order_tests_order ON lab_order_tests (order_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lab_order_tests_line ON lab_order_tests (bill_service_line_id);

CREATE TABLE IF NOT EXISTS lab_samples (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT NOT NULL REFERENCES lab_orders(id),
  code               TEXT NOT NULL UNIQUE,     -- the barcode: S-000123, from counters 'lab_sample_no'
  sample_type_id     TEXT,
  sample_type_name   TEXT NOT NULL DEFAULT '',
  -- waiting | collected | rejected | recollection | cancelled
  status             TEXT NOT NULL DEFAULT 'waiting',
  rejection_reason   TEXT NOT NULL DEFAULT '',
  collected_at       TEXT,
  collected_by       TEXT REFERENCES users(id),
  collected_by_name  TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_samples_order ON lab_samples (order_id);
CREATE INDEX IF NOT EXISTS idx_lab_samples_status ON lab_samples (status, created_at);

CREATE TABLE IF NOT EXISTS lab_sample_events (
  id           TEXT PRIMARY KEY,
  sample_id    TEXT NOT NULL REFERENCES lab_samples(id),
  from_status  TEXT NOT NULL DEFAULT '',
  to_status    TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT '',
  user_id      TEXT REFERENCES users(id),
  user_name    TEXT NOT NULL DEFAULT '',
  at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_sample_events ON lab_sample_events (sample_id, at);

-- one per ordered test; the values hang off it
CREATE TABLE IF NOT EXISTS lab_results (
  id                       TEXT PRIMARY KEY,
  order_id                 TEXT NOT NULL REFERENCES lab_orders(id),
  order_test_id            TEXT NOT NULL UNIQUE REFERENCES lab_order_tests(id),
  test_id                  TEXT NOT NULL REFERENCES lab_tests(id),
  test_name                TEXT NOT NULL,
  sample_id                TEXT REFERENCES lab_samples(id),
  -- pending | draft | submitted | correction_required | approved | dispatched | cancelled
  status                   TEXT NOT NULL DEFAULT 'pending',
  has_abnormal             INTEGER NOT NULL DEFAULT 0,
  has_critical             INTEGER NOT NULL DEFAULT 0,
  technician_remarks       TEXT NOT NULL DEFAULT '',
  interpretation           TEXT NOT NULL DEFAULT '',
  correction_note          TEXT NOT NULL DEFAULT '',
  entered_by               TEXT REFERENCES users(id),
  entered_by_name          TEXT NOT NULL DEFAULT '',
  submitted_at             TEXT,
  approved_by              TEXT REFERENCES users(id),
  approved_by_name         TEXT NOT NULL DEFAULT '',
  approved_at              TEXT,
  version                  INTEGER NOT NULL DEFAULT 1,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_results_order ON lab_results (order_id, status);
CREATE INDEX IF NOT EXISTS idx_lab_results_status ON lab_results (status);

CREATE TABLE IF NOT EXISTS lab_result_values (
  id             TEXT PRIMARY KEY,
  result_id      TEXT NOT NULL REFERENCES lab_results(id),
  parameter_id   TEXT,               -- null for a single-value test
  label          TEXT NOT NULL,
  value_text     TEXT NOT NULL DEFAULT '',
  value_num      REAL,
  unit           TEXT NOT NULL DEFAULT '',
  ref_text       TEXT NOT NULL DEFAULT '',
  ref_low        REAL,
  ref_high       REAL,
  -- normal | low | high | critical_low | critical_high | abnormal
  flag           TEXT NOT NULL DEFAULT 'normal',
  remarks        TEXT NOT NULL DEFAULT '',
  sort_order     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lab_result_values ON lab_result_values (result_id, sort_order);

-- what a result looked like at each submit and each change after it
CREATE TABLE IF NOT EXISTS lab_result_versions (
  id          TEXT PRIMARY KEY,
  result_id   TEXT NOT NULL REFERENCES lab_results(id),
  version     INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,
  reason      TEXT NOT NULL DEFAULT '',
  user_id     TEXT REFERENCES users(id),
  user_name   TEXT NOT NULL DEFAULT '',
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_result_versions ON lab_result_versions (result_id, version);

CREATE TABLE IF NOT EXISTS lab_result_approvals (
  id               TEXT PRIMARY KEY,
  result_id        TEXT NOT NULL REFERENCES lab_results(id),
  action           TEXT NOT NULL,      -- approved | sent_back | reopened
  reason           TEXT NOT NULL DEFAULT '',
  interpretation   TEXT NOT NULL DEFAULT '',
  signatory_ids    TEXT NOT NULL DEFAULT '[]',
  user_id          TEXT REFERENCES users(id),
  user_name        TEXT NOT NULL DEFAULT '',
  at               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_result_approvals ON lab_result_approvals (result_id, at);

CREATE TABLE IF NOT EXISTS lab_report_dispatches (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES lab_orders(id),
  channel     TEXT NOT NULL,           -- printed | collected
  note        TEXT NOT NULL DEFAULT '',
  user_id     TEXT REFERENCES users(id),
  user_name   TEXT NOT NULL DEFAULT '',
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_report_dispatches ON lab_report_dispatches (order_id, at);

-- every opening of the patient's link; no names, no phone numbers
CREATE TABLE IF NOT EXISTS lab_report_views (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES lab_orders(id),
  outcome     TEXT NOT NULL,           -- shown | not_ready | payment_pending
  ip          TEXT NOT NULL DEFAULT '',
  user_agent  TEXT NOT NULL DEFAULT '',
  at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lab_report_views ON lab_report_views (order_id, at);

-- ============================================================
-- the printed report
-- ============================================================
-- Signature blocks printed at the foot of every report page. The image is a
-- small resized picture held as a data URL, exactly like the company's bill
-- letterhead (company.logo_url): it is printed on every report, so it is not
-- a secret, and keeping it here means the patient's page needs no file route.
CREATE TABLE IF NOT EXISTS lab_signatories (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',   -- designation / qualification / council no.
  image        TEXT NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- One row. The report's own header and footer images (often not the bill's
-- letterhead) and the blank margins for printing on a pre-printed pad.
CREATE TABLE IF NOT EXISTS lab_settings (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  -- the counter group lab tests are billed under; made on the first test
  service_group_id      TEXT REFERENCES service_groups(id),
  -- data URLs, as above; empty = use the bill letterhead / nothing
  header_image          TEXT NOT NULL DEFAULT '',
  footer_image          TEXT NOT NULL DEFAULT '',
  margin_top_mm         INTEGER NOT NULL DEFAULT 14,
  margin_bottom_mm      INTEGER NOT NULL DEFAULT 14,
  margin_x_mm           INTEGER NOT NULL DEFAULT 12,
  updated_at            TEXT NOT NULL
);
INSERT OR IGNORE INTO lab_settings (id, updated_at) VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

INSERT OR IGNORE INTO counters (name, next_value) VALUES ('lab_order_no', 1);
INSERT OR IGNORE INTO counters (name, next_value) VALUES ('lab_sample_no', 1);

-- The two lab roles start on their own work queues, not the dashboard (which
-- shows the day's takings). Only changed if nobody has edited them since 0022.
UPDATE roles SET permissions = '["patients.view","lab.samples","lab.results","lab.reports","lab.dispatch"]'
 WHERE id = 'lab_technician'
   AND permissions = '["dashboard.view","patients.view","lab.samples","lab.results","lab.reports","lab.dispatch"]';
UPDATE roles SET permissions = '["patients.view","lab.results","lab.approve","lab.reports"]'
 WHERE id = 'pathologist'
   AND permissions = '["dashboard.view","patients.view","lab.results","lab.approve","lab.reports"]';
