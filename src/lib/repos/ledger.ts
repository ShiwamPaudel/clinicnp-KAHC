/**
 * ledger.ts — the books, read straight from what the app already records.
 *
 * Every bill, return, dues payment, purchase, purchase return, supplier and
 * laboratory payment, stock out and opening stock is turned into debit and
 * credit lines here, when a report asks — nothing is copied into a second
 * table (0025, prod-docs/Accounting.md). Vouchers entered by hand join them.
 * So the books cannot disagree with the bill, the Dues list or a supplier's
 * page: they are read from the same rows.
 *
 * What each document posts:
 *
 *   Bill             Dr cash / QR (paid now), Dr patients' dues (left owing)
 *                    Cr medicine sales / clinic / laboratory / sent-out income
 *                    Dr discount allowed (shared across those parts)
 *                    Cr VAT collected, rounding either way
 *                    Dr cost of medicines sold, Cr medicine stock (batch cost)
 *                    Dr doctors' shares, Cr the doctor (frozen share)
 *                    Dr outside laboratory charges, Cr the laboratory
 *   Cancelled bill   the same, reversed on the day it was cancelled
 *   Return / refund  Dr the income it came from; Cr patients' dues (taken off
 *                    what is owed first), Cr cash (handed back); stock back
 *                    at batch cost; the doctor's share taken back in proportion,
 *                    and a refunded sent-out test taken off the laboratory
 *                    (as its statement and Payables count it)
 *   Dues payment     Dr cash / QR, Cr patients' dues; undone on the day voided
 *   Purchase         Dr stock (after line discounts), Dr VAT paid,
 *                    Cr discount received (bill discount), rounding,
 *                    Cr the supplier
 *   Purchase return  Dr the supplier, Cr stock
 *   Test sent out    Dr outside laboratory charges, Cr the laboratory, on the
 *   (Result entry)   day its price became known; an undo reversed on its day
 *   Supplier / lab   Dr the supplier or laboratory, Cr cash or the bank chosen
 *   payment          ("Bank (account not chosen)" when none was)
 *   Stock out        Dr the reason's expense, Cr stock (at cost); stock in
 *                    the other way. A return to the supplier posts as the
 *                    purchase return it created, never twice.
 *   Opening stock    Dr stock, Cr opening balances
 *   Voucher          its own lines; a cancelled one reversed on the day
 *
 * The rules for what a bill still owes live in lib/dues.ts and
 * OWED_AT_SALE_SQL (Rules §2.11); this file uses them, never a second formula.
 */
import "server-only";
import type { Row } from "@libsql/client";
import { db } from "@/lib/db";
import { OWED_AT_SALE_SQL } from "@/lib/repos/dues";
import { SENDOUT_MOVES_SQL } from "@/lib/repos/lab-sendouts";
import type { AccountKind, PartyType } from "@/lib/accounting";

/** A timestamp as the clinic's own calendar day (Nepal is UTC+5:45). */
const NPT = (col: string) => `date(${col}, '+345 minutes')`;

const IN_RANGE = (col: string) => `(${col} BETWEEN :from AND :to)`;

/** Which part of the clinic a service line belongs to. */
const SERVICE_CLASS = `(CASE
  WHEN EXISTS (SELECT 1 FROM lab_tests lt WHERE lt.service_id = sl.service_id)
    OR EXISTS (SELECT 1 FROM lab_test_groups lg WHERE lg.service_id = sl.service_id) THEN 'lab'
  WHEN sl.lab_partner_id IS NOT NULL THEN 'sendout'
  ELSE 'clinic' END)`;

const CLASS_SEGMENT = (cls: string) => `(CASE ${cls} WHEN 'clinic' THEN 'clinic' ELSE 'lab' END)`;

const MONEY_ACCOUNT = (method: string) => `(CASE ${method}
  WHEN 'qr' THEN 'sys:qr'
  WHEN 'bank' THEN 'sys:bank_unassigned'
  WHEN 'cheque' THEN 'sys:bank_unassigned'
  WHEN 'adjustment' THEN 'sys:discount_recd'
  ELSE 'sys:cash' END)`;

const STOCK_OUT_ACCOUNT = `(CASE a.reason
  WHEN 'clinic_use' THEN 'sys:clinic_use'
  WHEN 'sample' THEN 'sys:samples'
  WHEN 'count_correction' THEN 'sys:stock_count'
  ELSE 'sys:stock_writeoff' END)`;

/**
 * Every journal line dated between :from and :to (AD, inclusive), as rows of
 * (src, src_id, doc, link, date_ad, account_id, party_type, party_id,
 * segment, dr, cr, narration, ref_ad, ref_no). Bind `{ from, to }`. `ref_ad`
 * and `ref_no` are set only on a voucher line naming an old bill (openings).
 */
export const JOURNAL_SQL = `
WITH
bp AS (
  SELECT b.id, b.date_ad, b.status,
         COALESCE(${NPT("b.cancelled_at")}, b.date_ad) AS cancel_ad,
         CASE WHEN b.invoice_no IS NULL THEN 'Bill'
              ELSE 'SI-' || IFNULL(f.bs_label, '') || '-' || printf('%06d', b.invoice_no) END AS doc,
         b.total_paisa AS total, b.discount_paisa AS disc, b.vat_paisa AS vat,
         CASE b.payment_method
           WHEN 'credit' THEN (CASE b.paid_now_method WHEN 'qr' THEN 'sys:qr' ELSE 'sys:cash' END)
           WHEN 'qr' THEN 'sys:qr' ELSE 'sys:cash' END AS money_acc,
         ${OWED_AT_SALE_SQL} AS owed,
         CASE WHEN b.patient_id IS NOT NULL THEN 'patient' ELSE 'walkin' END AS ptype,
         COALESCE(b.patient_id, TRIM(b.patient_name)) AS pid,
         (SELECT IFNULL(SUM(bl.amount_paisa), 0) FROM bill_lines bl WHERE bl.bill_id = b.id) AS med,
         (SELECT IFNULL(SUM(sl.amount_paisa), 0) FROM bill_service_lines sl WHERE sl.bill_id = b.id AND ${SERVICE_CLASS} = 'clinic') AS clinic,
         (SELECT IFNULL(SUM(sl.amount_paisa), 0) FROM bill_service_lines sl WHERE sl.bill_id = b.id AND ${SERVICE_CLASS} = 'lab') AS lab,
         (SELECT IFNULL(SUM(sl.amount_paisa), 0) FROM bill_service_lines sl WHERE sl.bill_id = b.id AND ${SERVICE_CLASS} = 'sendout') AS sendout,
         (SELECT IFNULL(SUM(bb.base_qty * bt.purchase_cost_paisa_per_base), 0)
            FROM bill_line_batches bb
            JOIN bill_lines bl ON bl.id = bb.bill_line_id
            JOIN batches bt ON bt.id = bb.batch_id
           WHERE bl.bill_id = b.id) AS cogs
    FROM bills b
    LEFT JOIN fiscal_years f ON f.id = b.fiscal_year_id
   WHERE ${IN_RANGE("b.date_ad")}
      OR (b.status = 'cancelled' AND ${IN_RANGE(`COALESCE(${NPT("b.cancelled_at")}, b.date_ad)`)})
),
bx AS (
  SELECT bp.*, med + clinic + lab + sendout AS parts,
         CASE WHEN med + clinic + lab + sendout > 0 THEN disc * med / (med + clinic + lab + sendout) ELSE 0 END AS d_med,
         CASE WHEN med + clinic + lab + sendout > 0 THEN disc * lab / (med + clinic + lab + sendout) ELSE 0 END AS d_lab,
         CASE WHEN med + clinic + lab + sendout > 0 THEN disc * sendout / (med + clinic + lab + sendout) ELSE 0 END AS d_sendout
    FROM bp
),
bill_legs AS (
  SELECT id, money_acc AS acc, NULL AS pt, NULL AS pi, NULL AS seg, total - owed AS dr, 0 AS cr, 'Paid at the counter' AS nar FROM bx WHERE total - owed <> 0
  UNION ALL SELECT id, 'sys:recv_patients', ptype, pid, NULL, owed, 0, 'Left owing' FROM bx WHERE owed <> 0
  UNION ALL SELECT id, 'sys:sales_pharmacy', NULL, NULL, 'pharmacy', 0, med, 'Medicines' FROM bx WHERE med <> 0
  UNION ALL SELECT id, 'sys:income_clinic', NULL, NULL, 'clinic', 0, clinic, 'Clinic services' FROM bx WHERE clinic <> 0
  UNION ALL SELECT id, 'sys:income_lab', NULL, NULL, 'lab', 0, lab, 'Laboratory tests' FROM bx WHERE lab <> 0
  UNION ALL SELECT id, 'sys:income_sendout', NULL, NULL, 'lab', 0, sendout, 'Tests sent out' FROM bx WHERE sendout <> 0
  UNION ALL SELECT id, 'sys:discount_allowed', NULL, NULL, 'pharmacy', d_med, 0, 'Discount' FROM bx WHERE d_med <> 0
  UNION ALL SELECT id, 'sys:discount_allowed', NULL, NULL, 'lab', d_lab + d_sendout, 0, 'Discount' FROM bx WHERE d_lab + d_sendout <> 0
  UNION ALL SELECT id, 'sys:discount_allowed', NULL, CASE WHEN parts > 0 THEN NULL END, CASE WHEN parts > 0 THEN 'clinic' END,
                   disc - d_med - d_lab - d_sendout, 0, 'Discount' FROM bx WHERE disc - d_med - d_lab - d_sendout <> 0
  UNION ALL SELECT id, 'sys:vat_output', NULL, NULL, NULL, 0, vat, 'VAT' FROM bx WHERE vat <> 0
  UNION ALL SELECT id, 'sys:round_off', NULL, NULL, NULL,
                   CASE WHEN total + disc - vat - parts < 0 THEN parts + vat - total - disc ELSE 0 END,
                   CASE WHEN total + disc - vat - parts > 0 THEN total + disc - vat - parts ELSE 0 END,
                   'Rounding' FROM bx WHERE total + disc - vat - parts <> 0
  UNION ALL SELECT id, 'sys:cogs', NULL, NULL, 'pharmacy', cogs, 0, 'Cost of medicines sold' FROM bx WHERE cogs <> 0
  UNION ALL SELECT id, 'sys:stock', NULL, NULL, 'pharmacy', 0, cogs, 'Medicines off the shelf' FROM bx WHERE cogs <> 0
  UNION ALL SELECT sl.bill_id, 'sys:doctor_share', NULL, NULL, ${CLASS_SEGMENT(SERVICE_CLASS)}, sl.doctor_share_paisa, 0, 'Doctor''s share'
              FROM bill_service_lines sl JOIN bx ON bx.id = sl.bill_id
             WHERE sl.doctor_id IS NOT NULL AND sl.doctor_share_paisa <> 0
  UNION ALL SELECT sl.bill_id, 'sys:pay_doctors', 'doctor', sl.doctor_id, NULL, 0, sl.doctor_share_paisa, 'Doctor''s share'
              FROM bill_service_lines sl JOIN bx ON bx.id = sl.bill_id
             WHERE sl.doctor_id IS NOT NULL AND sl.doctor_share_paisa <> 0
  UNION ALL SELECT sl.bill_id, 'sys:sendout_cost', NULL, NULL, 'lab', sl.partner_cost_paisa * sl.qty, 0, 'Sent to an outside laboratory'
              FROM bill_service_lines sl JOIN bx ON bx.id = sl.bill_id
             WHERE sl.lab_partner_id IS NOT NULL AND sl.partner_cost_paisa * sl.qty <> 0
  UNION ALL SELECT sl.bill_id, 'sys:pay_labs', 'lab_partner', sl.lab_partner_id, NULL, 0, sl.partner_cost_paisa * sl.qty, 'Sent to an outside laboratory'
              FROM bill_service_lines sl JOIN bx ON bx.id = sl.bill_id
             WHERE sl.lab_partner_id IS NOT NULL AND sl.partner_cost_paisa * sl.qty <> 0
),
rp AS (
  SELECT sr.id, sr.bill_id, sr.date_ad, sr.total_paisa AS total, sr.against_due_paisa AS against_due,
         CASE WHEN sr.return_no IS NULL THEN 'Return' ELSE 'SR-' || printf('%06d', sr.return_no) END AS doc,
         CASE WHEN b.patient_id IS NOT NULL THEN 'patient' ELSE 'walkin' END AS ptype,
         COALESCE(b.patient_id, TRIM(b.patient_name)) AS pid,
         (SELECT IFNULL(SUM(srl.amount_paisa), 0) FROM sale_return_lines srl WHERE srl.sale_return_id = sr.id) AS med,
         (SELECT IFNULL(SUM(x.amount_paisa), 0) FROM sale_return_service_lines x JOIN bill_service_lines sl ON sl.id = x.bill_service_line_id
           WHERE x.sale_return_id = sr.id AND ${SERVICE_CLASS} = 'clinic') AS clinic,
         (SELECT IFNULL(SUM(x.amount_paisa), 0) FROM sale_return_service_lines x JOIN bill_service_lines sl ON sl.id = x.bill_service_line_id
           WHERE x.sale_return_id = sr.id AND ${SERVICE_CLASS} = 'lab') AS lab,
         (SELECT IFNULL(SUM(x.amount_paisa), 0) FROM sale_return_service_lines x JOIN bill_service_lines sl ON sl.id = x.bill_service_line_id
           WHERE x.sale_return_id = sr.id AND ${SERVICE_CLASS} = 'sendout') AS sendout,
         (SELECT IFNULL(SUM(srl.base_qty * bt.purchase_cost_paisa_per_base), 0)
            FROM sale_return_lines srl JOIN batches bt ON bt.id = srl.batch_id
           WHERE srl.sale_return_id = sr.id) AS cogs
    FROM sale_returns sr
    JOIN bills b ON b.id = sr.bill_id
   WHERE ${IN_RANGE("sr.date_ad")}
),
return_legs AS (
  SELECT id, 'sys:sales_pharmacy' AS acc, NULL AS pt, NULL AS pi, 'pharmacy' AS seg, med AS dr, 0 AS cr, 'Medicines returned' AS nar FROM rp WHERE med <> 0
  UNION ALL SELECT id, 'sys:income_clinic', NULL, NULL, 'clinic', clinic, 0, 'Clinic services refunded' FROM rp WHERE clinic <> 0
  UNION ALL SELECT id, 'sys:income_lab', NULL, NULL, 'lab', lab, 0, 'Laboratory tests refunded' FROM rp WHERE lab <> 0
  UNION ALL SELECT id, 'sys:income_sendout', NULL, NULL, 'lab', sendout, 0, 'Sent-out tests refunded' FROM rp WHERE sendout <> 0
  UNION ALL SELECT id, 'sys:round_off', NULL, NULL, NULL,
                   CASE WHEN total > med + clinic + lab + sendout THEN total - (med + clinic + lab + sendout) ELSE 0 END,
                   CASE WHEN total < med + clinic + lab + sendout THEN med + clinic + lab + sendout - total ELSE 0 END,
                   'Rounding' FROM rp WHERE total <> med + clinic + lab + sendout
  UNION ALL SELECT id, 'sys:recv_patients', ptype, pid, NULL, 0, against_due, 'Taken off what is owed' FROM rp WHERE against_due <> 0
  UNION ALL SELECT id, 'sys:cash', NULL, NULL, NULL, 0, total - against_due, 'Handed back' FROM rp WHERE total - against_due <> 0
  UNION ALL SELECT id, 'sys:stock', NULL, NULL, 'pharmacy', cogs, 0, 'Back on the shelf' FROM rp WHERE cogs <> 0
  UNION ALL SELECT id, 'sys:cogs', NULL, NULL, 'pharmacy', 0, cogs, 'Cost of medicines returned' FROM rp WHERE cogs <> 0
  UNION ALL SELECT x.sale_return_id, 'sys:pay_doctors', 'doctor', sl.doctor_id, NULL,
                   sl.doctor_share_paisa * x.amount_paisa / sl.amount_paisa, 0, 'Doctor''s share taken back'
              FROM sale_return_service_lines x
              JOIN bill_service_lines sl ON sl.id = x.bill_service_line_id
              JOIN rp ON rp.id = x.sale_return_id
             WHERE sl.doctor_id IS NOT NULL AND sl.amount_paisa > 0
               AND sl.doctor_share_paisa * x.amount_paisa / sl.amount_paisa <> 0
  UNION ALL SELECT x.sale_return_id, 'sys:doctor_share', NULL, NULL, ${CLASS_SEGMENT(SERVICE_CLASS)},
                   0, sl.doctor_share_paisa * x.amount_paisa / sl.amount_paisa, 'Doctor''s share taken back'
              FROM sale_return_service_lines x
              JOIN bill_service_lines sl ON sl.id = x.bill_service_line_id
              JOIN rp ON rp.id = x.sale_return_id
             WHERE sl.doctor_id IS NOT NULL AND sl.amount_paisa > 0
               AND sl.doctor_share_paisa * x.amount_paisa / sl.amount_paisa <> 0
  UNION ALL SELECT x.sale_return_id, 'sys:pay_labs', 'lab_partner', sl.lab_partner_id, NULL,
                   sl.partner_cost_paisa * x.qty, 0, 'Refunded test taken off the laboratory'
              FROM sale_return_service_lines x
              JOIN bill_service_lines sl ON sl.id = x.bill_service_line_id
              JOIN rp ON rp.id = x.sale_return_id
             WHERE sl.lab_partner_id IS NOT NULL AND sl.partner_cost_paisa * x.qty <> 0
  UNION ALL SELECT x.sale_return_id, 'sys:sendout_cost', NULL, NULL, 'lab',
                   0, sl.partner_cost_paisa * x.qty, 'Refunded test taken off the laboratory'
              FROM sale_return_service_lines x
              JOIN bill_service_lines sl ON sl.id = x.bill_service_line_id
              JOIN rp ON rp.id = x.sale_return_id
             WHERE sl.lab_partner_id IS NOT NULL AND sl.partner_cost_paisa * x.qty <> 0
),
dues AS (
  SELECT dp.id, dp.bill_id, dp.receipt_id, dp.date_ad, ${NPT("dp.voided_at")} AS void_ad, dp.voided_at,
         dp.amount_paisa AS amt, CASE dp.method WHEN 'qr' THEN 'sys:qr' ELSE 'sys:cash' END AS acc,
         CASE WHEN b.patient_id IS NOT NULL THEN 'patient' ELSE 'walkin' END AS ptype,
         COALESCE(b.patient_id, TRIM(b.patient_name)) AS pid
    FROM due_payments dp
    JOIN bills b ON b.id = dp.bill_id
   WHERE ${IN_RANGE("dp.date_ad")} OR (dp.voided_at IS NOT NULL AND ${IN_RANGE(NPT("dp.voided_at"))})
),
pu AS (
  SELECT p.id, p.supplier_id, p.date_ad, COALESCE(p.purchase_no, 'Purchase') AS doc,
         p.supplier_invoice_no AS inv,
         p.subtotal_paisa - p.discount_paisa AS goods, p.bill_discount_paisa AS bdisc,
         p.vat_paisa AS vat, p.total_paisa AS total,
         p.total_paisa - (p.subtotal_paisa - p.discount_paisa - p.bill_discount_paisa + p.vat_paisa) AS rnd
    FROM purchases p
   WHERE ${IN_RANGE("p.date_ad")}
)
SELECT 'bill' AS src, l.id AS src_id, bx.doc, '/bills/' || l.id AS link, bx.date_ad,
       l.acc AS account_id, l.pt AS party_type, l.pi AS party_id, l.seg AS segment, l.dr, l.cr, l.nar AS narration, NULL AS ref_ad, NULL AS ref_no
  FROM bill_legs l JOIN bx ON bx.id = l.id
 WHERE ${IN_RANGE("bx.date_ad")}
UNION ALL
SELECT 'bill_cancel', l.id, bx.doc, '/bills/' || l.id, bx.cancel_ad,
       l.acc, l.pt, l.pi, l.seg, l.cr, l.dr, 'Cancelled: ' || l.nar, NULL, NULL
  FROM bill_legs l JOIN bx ON bx.id = l.id
 WHERE bx.status = 'cancelled' AND ${IN_RANGE("bx.cancel_ad")}
UNION ALL
SELECT 'return', l.id, rp.doc, '/bills/' || rp.bill_id, rp.date_ad,
       l.acc, l.pt, l.pi, l.seg, l.dr, l.cr, l.nar, NULL, NULL
  FROM return_legs l JOIN rp ON rp.id = l.id
UNION ALL
SELECT 'due_receipt', d.id, 'Dues receipt', '/bills/' || d.bill_id, d.date_ad, d.acc, NULL, NULL, NULL, d.amt, 0, 'Dues paid', NULL, NULL
  FROM dues d WHERE ${IN_RANGE("d.date_ad")}
UNION ALL
SELECT 'due_receipt', d.id, 'Dues receipt', '/bills/' || d.bill_id, d.date_ad, 'sys:recv_patients', d.ptype, d.pid, NULL, 0, d.amt, 'Dues paid', NULL, NULL
  FROM dues d WHERE ${IN_RANGE("d.date_ad")}
UNION ALL
SELECT 'due_void', d.id, 'Dues receipt undone', '/bills/' || d.bill_id, d.void_ad, d.acc, NULL, NULL, NULL, 0, d.amt, 'Dues payment undone', NULL, NULL
  FROM dues d WHERE d.voided_at IS NOT NULL AND ${IN_RANGE("d.void_ad")}
UNION ALL
SELECT 'due_void', d.id, 'Dues receipt undone', '/bills/' || d.bill_id, d.void_ad, 'sys:recv_patients', d.ptype, d.pid, NULL, d.amt, 0, 'Dues payment undone', NULL, NULL
  FROM dues d WHERE d.voided_at IS NOT NULL AND ${IN_RANGE("d.void_ad")}
UNION ALL
SELECT 'purchase', pu.id, pu.doc, '/suppliers/' || pu.supplier_id, pu.date_ad, 'sys:stock', NULL, NULL, 'pharmacy', pu.goods, 0,
       CASE WHEN pu.inv <> '' THEN 'Supplier bill ' || pu.inv ELSE 'Medicines bought' END, NULL, NULL
  FROM pu WHERE pu.goods <> 0
UNION ALL
SELECT 'purchase', pu.id, pu.doc, '/suppliers/' || pu.supplier_id, pu.date_ad, 'sys:discount_recd', NULL, NULL, NULL, 0, pu.bdisc, 'Discount on the bill', NULL, NULL
  FROM pu WHERE pu.bdisc <> 0
UNION ALL
SELECT 'purchase', pu.id, pu.doc, '/suppliers/' || pu.supplier_id, pu.date_ad, 'sys:vat_input', NULL, NULL, NULL, pu.vat, 0, 'VAT on the bill', NULL, NULL
  FROM pu WHERE pu.vat <> 0
UNION ALL
SELECT 'purchase', pu.id, pu.doc, '/suppliers/' || pu.supplier_id, pu.date_ad, 'sys:round_off', NULL, NULL, NULL,
       CASE WHEN pu.rnd > 0 THEN pu.rnd ELSE 0 END, CASE WHEN pu.rnd < 0 THEN -pu.rnd ELSE 0 END, 'Rounding', NULL, NULL
  FROM pu WHERE pu.rnd <> 0
UNION ALL
SELECT 'purchase', pu.id, pu.doc, '/suppliers/' || pu.supplier_id, pu.date_ad, 'sys:pay_suppliers', 'supplier', pu.supplier_id, NULL, 0, pu.total,
       CASE WHEN pu.inv <> '' THEN 'Supplier bill ' || pu.inv ELSE 'Medicines bought' END, NULL, NULL
  FROM pu WHERE pu.total <> 0
UNION ALL
SELECT 'purchase_return', r.id, COALESCE(r.return_no, 'Purchase return'), '/suppliers/' || r.supplier_id, r.date_ad,
       'sys:pay_suppliers', 'supplier', r.supplier_id, NULL, r.total_paisa, 0, 'Returned to the supplier', NULL, NULL
  FROM purchase_returns r WHERE ${IN_RANGE("r.date_ad")} AND r.total_paisa <> 0
UNION ALL
SELECT 'purchase_return', r.id, COALESCE(r.return_no, 'Purchase return'), '/suppliers/' || r.supplier_id, r.date_ad,
       'sys:stock', NULL, NULL, 'pharmacy', 0, r.total_paisa, 'Returned to the supplier', NULL, NULL
  FROM purchase_returns r WHERE ${IN_RANGE("r.date_ad")} AND r.total_paisa <> 0
UNION ALL
SELECT 'supplier_payment', sp.id, 'Supplier payment', '/suppliers/' || sp.supplier_id, sp.date_ad,
       'sys:pay_suppliers', 'supplier', sp.supplier_id, NULL, sp.amount_paisa, 0,
       CASE WHEN sp.note <> '' THEN 'Paid · ' || sp.note ELSE 'Paid' END, NULL, NULL
  FROM supplier_payments sp WHERE ${IN_RANGE("sp.date_ad")} AND sp.amount_paisa <> 0
UNION ALL
SELECT 'supplier_payment', sp.id, 'Supplier payment', '/suppliers/' || sp.supplier_id, sp.date_ad,
       COALESCE(sp.account_id, ${MONEY_ACCOUNT("sp.method")}), NULL, NULL, NULL, 0, sp.amount_paisa,
       CASE WHEN sp.note <> '' THEN 'Paid · ' || sp.note ELSE 'Paid' END, NULL, NULL
  FROM supplier_payments sp WHERE ${IN_RANGE("sp.date_ad")} AND sp.amount_paisa <> 0
UNION ALL
SELECT 'lab_payment', lp.id, 'Laboratory payment', '/reports/lab-partners?partner=' || lp.lab_partner_id, lp.date_ad,
       'sys:pay_labs', 'lab_partner', lp.lab_partner_id, NULL, lp.amount_paisa, 0,
       CASE WHEN lp.note <> '' THEN 'Paid · ' || lp.note ELSE 'Paid' END, NULL, NULL
  FROM lab_partner_payments lp WHERE ${IN_RANGE("lp.date_ad")} AND lp.amount_paisa <> 0
UNION ALL
SELECT 'lab_payment', lp.id, 'Laboratory payment', '/reports/lab-partners?partner=' || lp.lab_partner_id, lp.date_ad,
       COALESCE(lp.account_id, ${MONEY_ACCOUNT("lp.method")}), NULL, NULL, NULL, 0, lp.amount_paisa,
       CASE WHEN lp.note <> '' THEN 'Paid · ' || lp.note ELSE 'Paid' END, NULL, NULL
  FROM lab_partner_payments lp WHERE ${IN_RANGE("lp.date_ad")} AND lp.amount_paisa <> 0
UNION ALL
SELECT CASE m.kind WHEN 'undo' THEN 'lab_sendout_undo' ELSE 'lab_sendout' END, m.id, 'Sent out',
       '/reports/lab-partners?partner=' || m.partner_id, m.date_ad,
       'sys:sendout_cost', NULL, NULL, 'lab',
       CASE WHEN m.amount > 0 THEN m.amount ELSE 0 END, CASE WHEN m.amount < 0 THEN -m.amount ELSE 0 END,
       CASE m.kind WHEN 'undo' THEN m.name || ' — not sent after all' ELSE m.name || ' sent out' END, NULL, NULL
  FROM (${SENDOUT_MOVES_SQL}) m WHERE ${IN_RANGE("m.date_ad")} AND m.amount <> 0
UNION ALL
SELECT CASE m.kind WHEN 'undo' THEN 'lab_sendout_undo' ELSE 'lab_sendout' END, m.id, 'Sent out',
       '/reports/lab-partners?partner=' || m.partner_id, m.date_ad,
       'sys:pay_labs', 'lab_partner', m.partner_id, NULL,
       CASE WHEN m.amount < 0 THEN -m.amount ELSE 0 END, CASE WHEN m.amount > 0 THEN m.amount ELSE 0 END,
       CASE m.kind WHEN 'undo' THEN m.name || ' — not sent after all' ELSE m.name || ' sent out' END, NULL, NULL
  FROM (${SENDOUT_MOVES_SQL}) m WHERE ${IN_RANGE("m.date_ad")} AND m.amount <> 0
UNION ALL
SELECT 'stock_out', a.id, CASE WHEN a.adjustment_no IS NULL THEN 'Stock out' ELSE 'SO-' || printf('%06d', a.adjustment_no) END,
       '/stock/out/' || a.id, a.date_ad,
       CASE WHEN a.direction = 'out' THEN ${STOCK_OUT_ACCOUNT} ELSE 'sys:stock' END, NULL, NULL,
       CASE WHEN a.direction = 'out' AND a.reason = 'clinic_use' THEN 'clinic' ELSE 'pharmacy' END,
       a.total_cost_paisa, 0, CASE WHEN a.direction = 'out' THEN 'Stock out' ELSE 'Stock in' END, NULL, NULL
  FROM stock_adjustments a
 WHERE ${IN_RANGE("a.date_ad")} AND a.purchase_return_id IS NULL AND a.total_cost_paisa <> 0
UNION ALL
SELECT 'stock_out', a.id, CASE WHEN a.adjustment_no IS NULL THEN 'Stock out' ELSE 'SO-' || printf('%06d', a.adjustment_no) END,
       '/stock/out/' || a.id, a.date_ad,
       CASE WHEN a.direction = 'out' THEN 'sys:stock' ELSE ${STOCK_OUT_ACCOUNT} END, NULL, NULL,
       CASE WHEN a.direction = 'in' AND a.reason = 'clinic_use' THEN 'clinic' ELSE 'pharmacy' END,
       0, a.total_cost_paisa, CASE WHEN a.direction = 'out' THEN 'Stock out' ELSE 'Stock in' END, NULL, NULL
  FROM stock_adjustments a
 WHERE ${IN_RANGE("a.date_ad")} AND a.purchase_return_id IS NULL AND a.total_cost_paisa <> 0
UNION ALL
SELECT 'opening_stock', ${NPT("sm.at")}, 'Opening stock', '/stock', ${NPT("sm.at")},
       'sys:stock', NULL, NULL, 'pharmacy', SUM(sm.base_qty_delta * bt.purchase_cost_paisa_per_base), 0, 'Stock on the shelf at the start', NULL, NULL
  FROM stock_moves sm JOIN batches bt ON bt.id = sm.batch_id
 WHERE sm.reason = 'opening' AND ${IN_RANGE(NPT("sm.at"))}
 GROUP BY ${NPT("sm.at")}
HAVING SUM(sm.base_qty_delta * bt.purchase_cost_paisa_per_base) <> 0
UNION ALL
SELECT 'opening_stock', ${NPT("sm.at")}, 'Opening stock', '/stock', ${NPT("sm.at")},
       'sys:opening', NULL, NULL, NULL, 0, SUM(sm.base_qty_delta * bt.purchase_cost_paisa_per_base), 'Stock on the shelf at the start', NULL, NULL
  FROM stock_moves sm JOIN batches bt ON bt.id = sm.batch_id
 WHERE sm.reason = 'opening' AND ${IN_RANGE(NPT("sm.at"))}
 GROUP BY ${NPT("sm.at")}
HAVING SUM(sm.base_qty_delta * bt.purchase_cost_paisa_per_base) <> 0
UNION ALL
SELECT 'voucher', v.id, vt.prefix || '-' || f.bs_label || '-' || printf('%04d', v.voucher_no), '/accounts/vouchers/' || v.id, v.date_ad,
       vl.account_id, vl.party_type, vl.party_id, a.segment, vl.debit_paisa, vl.credit_paisa,
       CASE WHEN vl.note <> '' THEN vl.note ELSE v.narration END, COALESCE(vl.ref_date_ad, v.date_ad), vl.ref_no
  FROM voucher_lines vl
  JOIN vouchers v ON v.id = vl.voucher_id
  JOIN fiscal_years f ON f.id = v.fiscal_year_id
  JOIN accounts a ON a.id = vl.account_id
  JOIN (SELECT 'payment' AS t, 'PV' AS prefix UNION ALL SELECT 'receipt', 'RV' UNION ALL SELECT 'contra', 'CV'
        UNION ALL SELECT 'journal', 'JV' UNION ALL SELECT 'opening', 'OB') vt ON vt.t = v.voucher_type
 WHERE ${IN_RANGE("v.date_ad")}
UNION ALL
SELECT 'voucher_cancel', v.id, vt.prefix || '-' || f.bs_label || '-' || printf('%04d', v.voucher_no), '/accounts/vouchers/' || v.id, v.cancel_date_ad,
       vl.account_id, vl.party_type, vl.party_id, a.segment, vl.credit_paisa, vl.debit_paisa,
       'Cancelled: ' || CASE WHEN vl.note <> '' THEN vl.note ELSE v.narration END, COALESCE(vl.ref_date_ad, v.date_ad), vl.ref_no
  FROM voucher_lines vl
  JOIN vouchers v ON v.id = vl.voucher_id
  JOIN fiscal_years f ON f.id = v.fiscal_year_id
  JOIN accounts a ON a.id = vl.account_id
  JOIN (SELECT 'payment' AS t, 'PV' AS prefix UNION ALL SELECT 'receipt', 'RV' UNION ALL SELECT 'contra', 'CV'
        UNION ALL SELECT 'journal', 'JV' UNION ALL SELECT 'opening', 'OB') vt ON vt.t = v.voucher_type
 WHERE v.status = 'cancelled' AND ${IN_RANGE("v.cancel_date_ad")}
`;

/** Before any date the clinic can have, for "everything up to". */
export const DAWN = "0001-01-01";

/** The day before an AD ISO date. */
export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface AccountTotal {
  accountId: string;
  drPaisa: number;
  crPaisa: number;
}

/** Debits and credits per account between two dates. */
export async function accountTotals(fromIso: string, toIso: string): Promise<Map<string, AccountTotal>> {
  const res = await db().execute({
    sql: `SELECT account_id, SUM(dr) AS dr, SUM(cr) AS cr FROM (${JOURNAL_SQL}) GROUP BY account_id`,
    args: { from: fromIso, to: toIso },
  });
  const out = new Map<string, AccountTotal>();
  for (const r of res.rows) {
    out.set(r.account_id as string, {
      accountId: r.account_id as string,
      drPaisa: Number(r.dr ?? 0),
      crPaisa: Number(r.cr ?? 0),
    });
  }
  return out;
}

export interface SegmentTotal {
  accountId: string;
  segment: string | null;
  drPaisa: number;
  crPaisa: number;
}

/** Debits and credits per account and part of the clinic, for profit and loss. */
export async function accountSegmentTotals(fromIso: string, toIso: string): Promise<SegmentTotal[]> {
  const res = await db().execute({
    sql: `SELECT account_id, segment, SUM(dr) AS dr, SUM(cr) AS cr FROM (${JOURNAL_SQL}) GROUP BY account_id, segment`,
    args: { from: fromIso, to: toIso },
  });
  return res.rows.map((r) => ({
    accountId: r.account_id as string,
    segment: (r.segment as string | null) ?? null,
    drPaisa: Number(r.dr ?? 0),
    crPaisa: Number(r.cr ?? 0),
  }));
}

/** Profit (income less expenses) over a range, all parts together. */
export async function profitBetween(fromIso: string, toIso: string): Promise<number> {
  if (fromIso > toIso) return 0;
  const res = await db().execute({
    sql: `SELECT a.kind, SUM(j.dr) AS dr, SUM(j.cr) AS cr
            FROM (${JOURNAL_SQL}) j JOIN accounts a ON a.id = j.account_id
           WHERE a.kind IN ('income', 'expense')
           GROUP BY a.kind`,
    args: { from: fromIso, to: toIso },
  });
  let profit = 0;
  for (const r of res.rows) profit += Number(r.cr ?? 0) - Number(r.dr ?? 0);
  return profit;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export interface JournalLine {
  src: string;
  srcId: string;
  doc: string;
  link: string;
  dateAd: string;
  accountId: string;
  accountName: string;
  partyType: PartyType | null;
  partyId: string | null;
  partyName: string;
  segment: string | null;
  drPaisa: number;
  crPaisa: number;
  narration: string;
}

const PARTY_NAME_JOINS = `
  LEFT JOIN accounts acc ON acc.id = j.account_id
  LEFT JOIN patients pt ON j.party_type = 'patient' AND pt.id = j.party_id
  LEFT JOIN suppliers su ON j.party_type = 'supplier' AND su.id = j.party_id
  LEFT JOIN lab_partners lp ON j.party_type = 'lab_partner' AND lp.id = j.party_id
  LEFT JOIN doctors dr ON j.party_type = 'doctor' AND dr.id = j.party_id
  LEFT JOIN parties pa ON j.party_type = 'party' AND pa.id = j.party_id`;

const PARTY_NAME = `COALESCE(pt.name, su.name, lp.name, dr.name, pa.name,
  CASE WHEN j.party_type = 'walkin' THEN j.party_id END, '')`;

function mapLine(r: Row): JournalLine {
  return {
    src: r.src as string,
    srcId: r.src_id as string,
    doc: (r.doc as string | null) ?? "",
    link: (r.link as string | null) ?? "",
    dateAd: r.date_ad as string,
    accountId: r.account_id as string,
    accountName: (r.account_name as string | null) ?? "",
    partyType: (r.party_type as PartyType | null) ?? null,
    partyId: (r.party_id as string | null) ?? null,
    partyName: (r.party_name as string | null) ?? "",
    segment: (r.segment as string | null) ?? null,
    drPaisa: Number(r.dr ?? 0),
    crPaisa: Number(r.cr ?? 0),
    narration: (r.narration as string | null) ?? "",
  };
}

const LINE_COLUMNS = `j.src, j.src_id, j.doc, j.link, j.date_ad, j.account_id, acc.name AS account_name,
  j.party_type, j.party_id, ${PARTY_NAME} AS party_name, j.segment, j.dr, j.cr, j.narration`;

/** Every line on one account between two dates, in date order. */
export async function accountLines(accountId: string, fromIso: string, toIso: string): Promise<JournalLine[]> {
  const res = await db().execute({
    sql: `SELECT ${LINE_COLUMNS} FROM (${JOURNAL_SQL}) j ${PARTY_NAME_JOINS}
           WHERE j.account_id = :acc
           ORDER BY j.date_ad, j.src, j.src_id`,
    args: { from: fromIso, to: toIso, acc: accountId },
  });
  return res.rows.map(mapLine);
}

/** Every line for one party between two dates, in date order. */
export async function partyLines(partyType: PartyType, partyId: string, fromIso: string, toIso: string): Promise<JournalLine[]> {
  const res = await db().execute({
    sql: `SELECT ${LINE_COLUMNS} FROM (${JOURNAL_SQL}) j ${PARTY_NAME_JOINS}
           WHERE j.party_type = :pt AND j.party_id = :pid
           ORDER BY j.date_ad, j.src, j.src_id`,
    args: { from: fromIso, to: toIso, pt: partyType, pid: partyId },
  });
  return res.rows.map(mapLine);
}

/** What one party's account stood at on a date (debit minus credit). */
export async function partyBalanceAt(partyType: PartyType, partyId: string, asOfIso: string): Promise<number> {
  const res = await db().execute({
    sql: `SELECT IFNULL(SUM(dr) - SUM(cr), 0) AS bal FROM (${JOURNAL_SQL}) j
           WHERE j.party_type = :pt AND j.party_id = :pid`,
    args: { from: DAWN, to: asOfIso, pt: partyType, pid: partyId },
  });
  return Number(res.rows[0]?.bal ?? 0);
}

/** Every line between two dates — the day book. */
export async function dayBookLines(fromIso: string, toIso: string, limit = 5000): Promise<JournalLine[]> {
  const res = await db().execute({
    sql: `SELECT ${LINE_COLUMNS} FROM (${JOURNAL_SQL}) j ${PARTY_NAME_JOINS}
           ORDER BY j.date_ad, j.src, j.src_id, j.dr DESC
           LIMIT :lim`,
    args: { from: fromIso, to: toIso, lim: limit },
  });
  return res.rows.map(mapLine);
}

export interface PartyBalance {
  partyType: PartyType;
  partyId: string;
  name: string;
  /** debit minus credit: + they owe the clinic, − the clinic owes them */
  balancePaisa: number;
  drPaisa: number;
  crPaisa: number;
}

/** Every party's balance on a date. */
export async function partyBalances(asOfIso: string): Promise<PartyBalance[]> {
  const res = await db().execute({
    sql: `SELECT j.party_type, j.party_id, ${PARTY_NAME} AS party_name,
                 SUM(j.dr) AS dr, SUM(j.cr) AS cr
            FROM (${JOURNAL_SQL}) j ${PARTY_NAME_JOINS}
           WHERE j.party_type IS NOT NULL
           GROUP BY j.party_type, j.party_id`,
    args: { from: DAWN, to: asOfIso },
  });
  return res.rows.map((r) => ({
    partyType: r.party_type as PartyType,
    partyId: r.party_id as string,
    name: (r.party_name as string | null) ?? "",
    drPaisa: Number(r.dr ?? 0),
    crPaisa: Number(r.cr ?? 0),
    balancePaisa: Number(r.dr ?? 0) - Number(r.cr ?? 0),
  }));
}

/**
 * Each party's movements up to a date, signed so + is "more is owed" on the
 * side the party normally sits (owed to the clinic for receivables, owed by
 * the clinic for payables). Feeds the oldest-first aging.
 */
export async function partyMovements(
  side: "receivable" | "payable",
  partyTypes: PartyType[],
  asOfIso: string,
): Promise<Map<string, { partyType: PartyType; partyId: string; name: string; moves: { dateAd: string; amountPaisa: number; ref: string }[] }>> {
  if (partyTypes.length === 0) return new Map();
  const placeholders = partyTypes.map((_, i) => `:t${i}`).join(", ");
  const args: Record<string, string> = { from: DAWN, to: asOfIso };
  partyTypes.forEach((t, i) => (args[`t${i}`] = t));
  // An opening line for an old bill ages from that bill's date, not the
  // opening's.
  const res = await db().execute({
    sql: `SELECT j.party_type, j.party_id, ${PARTY_NAME} AS party_name,
                 COALESCE(j.ref_ad, j.date_ad) AS age_ad,
                 CASE WHEN j.ref_no IS NOT NULL AND j.ref_no <> '' THEN j.ref_no ELSE j.doc END AS ref,
                 SUM(j.dr) AS dr, SUM(j.cr) AS cr
            FROM (${JOURNAL_SQL}) j ${PARTY_NAME_JOINS}
           WHERE j.party_type IN (${placeholders})
           GROUP BY j.party_type, j.party_id, j.src, j.src_id, COALESCE(j.ref_ad, j.date_ad), ref
           ORDER BY age_ad`,
    args,
  });
  const out = new Map<string, { partyType: PartyType; partyId: string; name: string; moves: { dateAd: string; amountPaisa: number; ref: string }[] }>();
  for (const r of res.rows) {
    const key = `${r.party_type}:${r.party_id}`;
    let p = out.get(key);
    if (!p) {
      p = { partyType: r.party_type as PartyType, partyId: r.party_id as string, name: (r.party_name as string | null) ?? "", moves: [] };
      out.set(key, p);
    }
    const net = Number(r.dr ?? 0) - Number(r.cr ?? 0);
    const amount = side === "receivable" ? net : -net;
    if (amount !== 0) p.moves.push({ dateAd: r.age_ad as string, amountPaisa: amount, ref: (r.ref as string | null) ?? "" });
  }
  return out;
}

/** Account kinds by id, for the reports that sort lines into headings. */
export async function accountKinds(): Promise<Map<string, AccountKind>> {
  const res = await db().execute("SELECT id, kind FROM accounts");
  return new Map(res.rows.map((r) => [r.id as string, r.kind as AccountKind]));
}

/** A party's name, or null when there is no such party. */
export async function partyDisplayName(type: PartyType, id: string): Promise<string | null> {
  if (type === "walkin") return id;
  const table = { patient: "patients", supplier: "suppliers", lab_partner: "lab_partners", doctor: "doctors", party: "parties" }[type];
  const res = await db().execute({ sql: `SELECT name FROM ${table} WHERE id = ?`, args: [id] });
  return (res.rows[0]?.name as string | undefined) ?? null;
}
