-- 0025_accounting.sql — double-entry accounts for the whole clinic.
-- See prod-docs/Accounting.md.
--
-- Append-only: never edit once applied.
--
-- How the books are kept
-- ----------------------
-- Everything the app already records — bills, returns, dues payments,
-- purchases, purchase returns, supplier and laboratory payments, stock out,
-- opening stock — is turned into debit and credit lines when a report is read
-- (src/lib/repos/ledger.ts). Nothing is copied into a second table, so the
-- books can never disagree with the bill, the Dues list or the supplier's
-- page, and nothing already working had to learn to "post" anything.
--
-- The only money entered here by hand is what the app has no screen for:
-- expenses, bank deposits and withdrawals, capital, loans, doctors' payouts,
-- other parties, and opening balances. Those are `vouchers`.
--
-- A voucher is never edited or deleted. A wrong one is cancelled, which
-- reverses it on the day it was cancelled; the original stays on its own day.
--
-- No CHECK on status columns (see 0013, 0015, 0016).

-- ============================================================
-- chart of accounts
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  -- asset | liability | equity | income | expense
  kind        TEXT NOT NULL,
  -- the heading it prints under: cash_bank, receivable, stock, current_asset,
  -- fixed_asset, payable, duty_tax, loan, current_liability, capital,
  -- direct_income, indirect_income, direct_expense, indirect_expense
  grp         TEXT NOT NULL,
  -- pharmacy | clinic | lab, or NULL for the whole clinic
  segment     TEXT,
  -- set on the accounts the app posts to by itself; they cannot be deleted
  -- or renamed into something else, only relabelled
  system_key  TEXT UNIQUE,
  is_bank     INTEGER NOT NULL DEFAULT 0,
  -- a control account is only ever touched through a party (patients,
  -- suppliers, laboratories, doctors, other parties)
  is_control  INTEGER NOT NULL DEFAULT 0,
  -- posted only by the app: medicine stock, patients' dues
  auto_only   INTEGER NOT NULL DEFAULT 0,
  note        TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ============================================================
-- other parties: anyone money is owed to or by who is not a patient,
-- supplier, outside laboratory or doctor (a landlord, an insurer, a
-- corporate client, a member of staff, a lender)
-- ============================================================
CREATE TABLE IF NOT EXISTS parties (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- debtor (owes the clinic) | creditor (the clinic owes them)
  side        TEXT NOT NULL DEFAULT 'creditor',
  -- insurance | corporate | staff | landlord | lender | other
  category    TEXT NOT NULL DEFAULT 'other',
  pan_no      TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ============================================================
-- vouchers entered by hand
-- ============================================================
CREATE TABLE IF NOT EXISTS vouchers (
  id              TEXT PRIMARY KEY,
  -- receipt | payment | contra | journal | opening
  voucher_type    TEXT NOT NULL,
  -- per type, per fiscal year, from counters 'voucher:<type>:<fiscal year id>'
  voucher_no      INTEGER NOT NULL,
  fiscal_year_id  INTEGER NOT NULL REFERENCES fiscal_years(id),
  date_ad         TEXT NOT NULL,
  date_bs         TEXT NOT NULL,
  narration       TEXT NOT NULL DEFAULT '',
  total_paisa     INTEGER NOT NULL DEFAULT 0,
  -- posted | cancelled
  status          TEXT NOT NULL DEFAULT 'posted',
  cancelled_at    TEXT,
  cancelled_by    TEXT REFERENCES users(id),
  cancel_reason   TEXT NOT NULL DEFAULT '',
  -- the day the reversal lands on
  cancel_date_ad  TEXT,
  cancel_date_bs  TEXT,
  user_id         TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL,
  UNIQUE (voucher_type, fiscal_year_id, voucher_no)
);
CREATE INDEX IF NOT EXISTS vouchers_date ON vouchers(date_ad);

CREATE TABLE IF NOT EXISTS voucher_lines (
  id            TEXT PRIMARY KEY,
  voucher_id    TEXT NOT NULL REFERENCES vouchers(id),
  line_no       INTEGER NOT NULL,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  -- supplier | lab_partner | doctor | party, or NULL
  party_type    TEXT,
  party_id      TEXT,
  debit_paisa   INTEGER NOT NULL DEFAULT 0,
  credit_paisa  INTEGER NOT NULL DEFAULT 0,
  -- an opening balance owed on an old bill keeps that bill's number and date,
  -- so it ages from the bill date like any other
  ref_no        TEXT NOT NULL DEFAULT '',
  ref_date_ad   TEXT,
  ref_date_bs   TEXT,
  note          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS voucher_lines_voucher ON voucher_lines(voucher_id);
CREATE INDEX IF NOT EXISTS voucher_lines_account ON voucher_lines(account_id);
CREATE INDEX IF NOT EXISTS voucher_lines_party ON voucher_lines(party_type, party_id);

-- ============================================================
-- what the existing screens need to say for the books
-- ============================================================
-- Which bank a supplier or laboratory was paid from. Empty for cash, and for
-- every payment made before this.
ALTER TABLE supplier_payments ADD COLUMN account_id TEXT REFERENCES accounts(id);
ALTER TABLE lab_partner_payments ADD COLUMN account_id TEXT REFERENCES accounts(id);

-- When a bill was cancelled, so the books reverse it on that day rather than
-- quietly rewriting the day it was sold. Empty on bills cancelled before this.
ALTER TABLE bills ADD COLUMN cancelled_at TEXT;

-- Indexes the ledger reads lean on.
CREATE INDEX IF NOT EXISTS bills_date ON bills(date_ad);
CREATE INDEX IF NOT EXISTS due_payments_bill ON due_payments(bill_id);
CREATE INDEX IF NOT EXISTS sale_returns_bill ON sale_returns(bill_id);
CREATE INDEX IF NOT EXISTS supplier_payments_supplier ON supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS lab_partner_payments_partner ON lab_partner_payments(lab_partner_id);

-- ============================================================
-- the accounts the app posts to by itself
-- ============================================================
-- Ids are fixed ('sys:...') because the ledger names them directly. Names
-- can be changed under Accounts -> Chart of accounts; what they do cannot.
INSERT OR IGNORE INTO accounts (id, code, name, kind, grp, segment, system_key, is_bank, is_control, auto_only, sort_order, created_at, updated_at) VALUES
  ('sys:cash',             '1000', 'Cash in hand',                    'asset',     'cash_bank',         NULL,       'cash',             0, 0, 0, 10, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:qr',               '1010', 'QR / wallet collections',         'asset',     'cash_bank',         NULL,       'qr',               0, 0, 0, 11, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:bank_unassigned',  '1090', 'Bank (account not chosen)',       'asset',     'cash_bank',         NULL,       'bank_unassigned',  1, 0, 0, 19, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:recv_patients',    '1100', 'Patients'' dues',                 'asset',     'receivable',        NULL,       'recv_patients',    0, 1, 1, 20, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:recv_parties',     '1110', 'Other parties (receivable)',      'asset',     'receivable',        NULL,       'recv_parties',     0, 1, 0, 21, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:stock',            '1200', 'Medicine stock',                  'asset',     'stock',             'pharmacy', 'stock',            0, 0, 1, 30, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:vat_input',        '1300', 'VAT paid on purchases',           'asset',     'duty_tax',          NULL,       'vat_input',        0, 0, 0, 40, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:pay_suppliers',    '2000', 'Suppliers',                       'liability', 'payable',           NULL,       'pay_suppliers',    0, 1, 0, 10, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:pay_labs',         '2010', 'Outside laboratories',            'liability', 'payable',           NULL,       'pay_labs',         0, 1, 0, 11, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:pay_doctors',      '2020', 'Doctors'' shares',                'liability', 'payable',           NULL,       'pay_doctors',      0, 1, 0, 12, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:pay_parties',      '2030', 'Other parties (payable)',         'liability', 'payable',           NULL,       'pay_parties',      0, 1, 0, 13, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:vat_output',       '2100', 'VAT collected on sales',          'liability', 'duty_tax',          NULL,       'vat_output',       0, 0, 0, 20, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:tds_payable',      '2110', 'TDS to deposit',                  'liability', 'duty_tax',          NULL,       'tds_payable',      0, 0, 0, 21, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:capital',          '3000', 'Capital',                         'equity',    'capital',           NULL,       'capital',          0, 0, 0, 10, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:opening',          '3900', 'Opening balances (to be moved)',  'equity',    'capital',           NULL,       'opening',          0, 0, 0, 90, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:sales_pharmacy',   '4000', 'Medicine sales',                  'income',    'direct_income',     'pharmacy', 'sales_pharmacy',   0, 0, 0, 10, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:income_clinic',    '4100', 'Clinic services',                 'income',    'direct_income',     'clinic',   'income_clinic',    0, 0, 0, 20, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:income_lab',       '4200', 'Laboratory tests',                'income',    'direct_income',     'lab',      'income_lab',       0, 0, 0, 30, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:income_sendout',   '4210', 'Tests sent out',                  'income',    'direct_income',     'lab',      'income_sendout',   0, 0, 0, 31, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:discount_recd',    '4900', 'Discount received',               'income',    'indirect_income',   NULL,       'discount_recd',    0, 0, 0, 90, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:cogs',             '5000', 'Cost of medicines sold',          'expense',   'direct_expense',    'pharmacy', 'cogs',             0, 0, 0, 10, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:doctor_share',     '5100', 'Doctors'' shares',                'expense',   'direct_expense',    'clinic',   'doctor_share',     0, 0, 0, 20, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:sendout_cost',     '5200', 'Outside laboratory charges',      'expense',   'direct_expense',    'lab',      'sendout_cost',     0, 0, 0, 30, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:stock_writeoff',   '5300', 'Medicines written off',           'expense',   'direct_expense',    'pharmacy', 'stock_writeoff',   0, 0, 0, 40, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:clinic_use',       '5310', 'Medicines used in the clinic',    'expense',   'direct_expense',    'clinic',   'clinic_use',       0, 0, 0, 41, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:samples',          '5320', 'Free samples given',              'expense',   'direct_expense',    'pharmacy', 'samples',          0, 0, 0, 42, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:stock_count',      '5330', 'Stock count differences',         'expense',   'direct_expense',    'pharmacy', 'stock_count',      0, 0, 0, 43, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:discount_allowed', '5900', 'Discount allowed',                'expense',   'indirect_expense',  NULL,       'discount_allowed', 0, 0, 0, 90, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('sys:round_off',        '5950', 'Rounding',                        'expense',   'indirect_expense',  NULL,       'round_off',        0, 0, 0, 95, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Everyday heads an accountant would otherwise type in on the first morning.
-- Ordinary accounts: rename, switch off or add to them freely.
INSERT OR IGNORE INTO accounts (id, code, name, kind, grp, segment, sort_order, created_at, updated_at) VALUES
  ('acc:furniture',   '1500', 'Furniture and fixtures',          'asset',   'fixed_asset',      NULL,  50, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:equipment',   '1510', 'Medical and laboratory equipment', 'asset',  'fixed_asset',      NULL,  51, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:computers',   '1520', 'Computers and printers',          'asset',   'fixed_asset',      NULL,  52, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:deposits',    '1600', 'Deposits and advances paid',      'asset',   'current_asset',    NULL,  60, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:loans',       '2500', 'Loans',                           'liability','loan',            NULL,  50, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:salary_pay',  '2600', 'Salaries payable',                'liability','current_liability',NULL, 60, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:other_income','4950', 'Other income',                    'income',  'indirect_income',  NULL,  95, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:reagents',    '5400', 'Laboratory reagents and kits',    'expense', 'direct_expense',   'lab', 50, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:consumables', '5410', 'Medical consumables',             'expense', 'direct_expense',   'clinic',51, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:salaries',    '6000', 'Salaries and wages',              'expense', 'indirect_expense', NULL,  10, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:rent',        '6010', 'Rent',                            'expense', 'indirect_expense', NULL,  11, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:electricity', '6020', 'Electricity',                     'expense', 'indirect_expense', NULL,  12, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:water',       '6030', 'Water',                           'expense', 'indirect_expense', NULL,  13, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:internet',    '6040', 'Telephone and internet',          'expense', 'indirect_expense', NULL,  14, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:repairs',     '6050', 'Repairs and maintenance',         'expense', 'indirect_expense', NULL,  15, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:cleaning',    '6060', 'Cleaning and housekeeping',       'expense', 'indirect_expense', NULL,  16, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:stationery',  '6070', 'Printing and stationery',         'expense', 'indirect_expense', NULL,  17, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:bank_charges','6080', 'Bank and wallet charges',         'expense', 'indirect_expense', NULL,  18, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:transport',   '6090', 'Fuel and transport',              'expense', 'indirect_expense', NULL,  19, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:misc',        '6900', 'Miscellaneous expenses',          'expense', 'indirect_expense', NULL,  90, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- The Accountant role gets the books, if nobody has edited it since 0022.
UPDATE roles SET permissions = '["dashboard.view","bills.view","dues.view","dues.collect","patients.view","stock.view","suppliers.manage","reports.view","reports.all","accounts.view","accounts.post","accounts.setup"]'
 WHERE id = 'accountant'
   AND permissions = '["dashboard.view","bills.view","dues.view","dues.collect","patients.view","stock.view","suppliers.manage","reports.view","reports.all"]';
