-- 0030_payment_charges.sql — fund transfer charges on payments, delivery on purchases.
--
-- Append-only: never edit once applied.
--
-- A payment made by QR or bank often costs a fee on top (IPS, Rs 8, Rs 10…).
-- It is not owed to the supplier or laboratory and never reduces what is owed
-- to them: it is the clinic's own expense, Bank and wallet charges, paid out
-- of the same money as the payment (owner, 2083-08-06). A payment voucher
-- carries it as an ordinary line; supplier and laboratory payments keep it on
-- the payment row, and the books read it from there.
--
-- A supplier payment may now say which purchase bill it is for. Delivery paid
-- to a courier for a purchase is a payment voucher (Miscellaneous expenses)
-- that names the purchase, so it shows on that bill.

ALTER TABLE supplier_payments ADD COLUMN transfer_charge_paisa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supplier_payments ADD COLUMN purchase_id TEXT REFERENCES purchases(id);
ALTER TABLE lab_partner_payments ADD COLUMN transfer_charge_paisa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vouchers ADD COLUMN purchase_id TEXT REFERENCES purchases(id);
CREATE INDEX IF NOT EXISTS vouchers_purchase ON vouchers (purchase_id);

-- The app now posts to these two by itself, so they become system accounts:
-- still renamable, never deleted or switched off.
INSERT OR IGNORE INTO accounts (id, code, name, kind, grp, segment, sort_order, created_at, updated_at) VALUES
  ('acc:bank_charges','6080', 'Bank and wallet charges', 'expense', 'indirect_expense', NULL, 18, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('acc:misc',        '6900', 'Miscellaneous expenses',  'expense', 'indirect_expense', NULL, 90, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'));
UPDATE accounts SET system_key = 'bank_charges', active = 1 WHERE id = 'acc:bank_charges' AND system_key IS NULL;
UPDATE accounts SET system_key = 'misc', active = 1 WHERE id = 'acc:misc' AND system_key IS NULL;
