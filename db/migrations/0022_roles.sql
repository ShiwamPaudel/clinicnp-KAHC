-- 0022_roles.sql — roles the Admin can edit, and sign-in by password only.
--
-- Append-only: never edit once applied.
--
-- @rebuild  users carries CHECK (role IN ('admin','staff','accountant','doctor'))
--           and a pin_hash column; both go, so the table is rebuilt the way
--           0006 and 0018 rebuilt it.
-- @verify   users, doctors
--
-- Until now a person was one of four fixed kinds. A clinic with a laboratory
-- and a pharmacy has more jobs than that — the person drawing blood should
-- not be able to cancel a bill, and the pathologist signing reports has no
-- business in purchases — so a role is now a name plus a list of permission
-- keys (src/lib/permissions.ts), and the Admin edits the list.
--
-- Two roles are fixed and their ids are fixed: `admin` (always everything —
-- the code ignores its stored list) and `doctor` (their own consultations and
-- nothing else). The others below are starting points the clinic can change.
--
-- The 4-digit PIN quick-switch is gone: everybody signs in with a username and
-- password, and to change who is using a screen you sign out and back in.
-- `can_edit_rate` is gone too; changing a price at the counter is now the
-- `counter.change_rate` permission on a role.
--
-- Existing people keep the nearest role: admin -> Admin, staff -> Front desk,
-- accountant -> Accountant, doctor -> Doctor.

CREATE TABLE IF NOT EXISTS roles (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  -- JSON array of permission keys; read through parsePermissions, which drops
  -- anything it does not recognise.
  permissions  TEXT NOT NULL DEFAULT '[]',
  is_system    INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 100,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

INSERT OR IGNORE INTO roles (id, name, description, permissions, is_system, sort_order, created_at, updated_at) VALUES
  ('admin', 'Admin', 'Everything, always.', '[]', 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('doctor', 'Doctor', 'Their own booked consultations, on their own phone. Nothing else.', '[]', 1, 90, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('front_desk', 'Front desk', 'Counter, patients, visits, bookings and dues.', '["dashboard.view","counter.use","bills.view","dues.view","dues.collect","patients.view","patients.manage","visits.view","visits.manage","appointments.manage","lab.sendout","lab.reports","stock.view","reports.view"]', 0, 10, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('pharmacist', 'Pharmacist', 'Counter, stock, medicines, prices and purchases.', '["dashboard.view","counter.use","counter.change_rate","bills.view","dues.view","dues.collect","patients.view","stock.view","stock.adjust","items.manage","prices.manage","purchases.manage","reports.view"]', 0, 20, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('lab_technician', 'Lab technician', 'Samples, result entry and handing over reports.', '["dashboard.view","patients.view","lab.samples","lab.results","lab.reports","lab.dispatch"]', 0, 30, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('pathologist', 'Pathologist', 'Checks, approves and signs lab reports.', '["dashboard.view","patients.view","lab.results","lab.approve","lab.reports"]', 0, 40, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('accountant', 'Accountant', 'Bills, dues, payables and every report. No counter.', '["dashboard.view","bills.view","dues.view","dues.collect","patients.view","stock.view","suppliers.manage","reports.view","reports.all"]', 0, 50, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE users_new (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role_id       TEXT NOT NULL REFERENCES roles(id),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

INSERT INTO users_new (id, name, username, password_hash, role_id, active, created_at)
  SELECT id, name, username, password_hash,
         CASE role WHEN 'admin' THEN 'admin'
                   WHEN 'accountant' THEN 'accountant'
                   WHEN 'doctor' THEN 'doctor'
                   ELSE 'front_desk' END,
         active, created_at
    FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role_id);
