/**
 * suppliers.ts — suppliers, payments, and the party ledger (running balance).
 */
import "server-only";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import type { Row } from "@/lib/db";
import { openingMoves } from "@/lib/repos/party-openings";
import { formatPaisa } from "@/lib/money";

export interface Supplier {
  id: string;
  name: string;
  panNo: string;
  phone: string;
  address: string;
  contactPerson: string;
  terms: string;
  active: boolean;
}

export interface SupplierInput {
  name: string;
  panNo: string;
  phone: string;
  address: string;
  contactPerson: string;
  terms: string;
  active: boolean;
}

function mapSupplier(r: Row): Supplier {
  return {
    id: r.id as string,
    name: r.name as string,
    panNo: r.pan_no as string,
    phone: r.phone as string,
    address: r.address as string,
    contactPerson: r.contact_person as string,
    terms: r.terms as string,
    active: Number(r.active) === 1,
  };
}

export async function listSuppliers(includeInactive = false): Promise<Supplier[]> {
  const sql = includeInactive
    ? "SELECT * FROM suppliers ORDER BY name ASC"
    : "SELECT * FROM suppliers WHERE active = 1 ORDER BY name ASC";
  const res = await db().execute(sql);
  return res.rows.map(mapSupplier);
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  const res = await db().execute({
    sql: "SELECT * FROM suppliers WHERE id = ?",
    args: [id],
  });
  return res.rows[0] ? mapSupplier(res.rows[0]) : null;
}

export async function createSupplier(input: SupplierInput): Promise<string> {
  const id = ulid();
  await db().execute({
    sql: `INSERT INTO suppliers
            (id, name, pan_no, phone, address, contact_person, terms, active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.name,
      input.panNo,
      input.phone,
      input.address,
      input.contactPerson,
      input.terms,
      input.active ? 1 : 0,
      new Date().toISOString(),
    ],
  });
  return id;
}

export async function updateSupplier(
  id: string,
  input: SupplierInput,
): Promise<void> {
  await db().execute({
    sql: `UPDATE suppliers SET
            name = ?, pan_no = ?, phone = ?, address = ?,
            contact_person = ?, terms = ?, active = ?
          WHERE id = ?`,
    args: [
      input.name,
      input.panNo,
      input.phone,
      input.address,
      input.contactPerson,
      input.terms,
      input.active ? 1 : 0,
      id,
    ],
  });
}

// ---- payments ----
export async function recordSupplierPayment(input: {
  supplierId: string;
  dateAd: string;
  dateBs: string;
  amountPaisa: number;
  method: string;
  note: string;
  userId: string;
  /** the bank it was paid from (0025); empty for cash */
  accountId?: string | null;
  /** the bank's or wallet's own fee for sending it (0030); not owed to the supplier */
  transferChargePaisa?: number;
  /** the purchase bill it pays, when one is named (0030) */
  purchaseId?: string | null;
}): Promise<void> {
  await db().execute({
    sql: `INSERT INTO supplier_payments
            (id, supplier_id, date_ad, date_bs, amount_paisa, method, note, user_id, created_at, account_id,
             transfer_charge_paisa, purchase_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      ulid(),
      input.supplierId,
      input.dateAd,
      input.dateBs,
      input.amountPaisa,
      input.method,
      input.note,
      input.userId,
      new Date().toISOString(),
      input.accountId ?? null,
      input.transferChargePaisa ?? 0,
      input.purchaseId ?? null,
    ],
  });
}

/** Whether a purchase bill is this supplier's. */
export async function purchaseBelongsTo(purchaseId: string, supplierId: string): Promise<boolean> {
  const res = await db().execute({
    sql: "SELECT 1 FROM purchases WHERE id = ? AND supplier_id = ?",
    args: [purchaseId, supplierId],
  });
  return res.rows.length > 0;
}

export interface SupplierPurchaseChoice {
  id: string;
  label: string;
}

/** A supplier's recent purchase bills, newest first, for "which bill is this for?". */
export async function listSupplierPurchaseChoices(supplierId: string, limit = 60): Promise<SupplierPurchaseChoice[]> {
  const res = await db().execute({
    sql: `SELECT id, purchase_no, supplier_invoice_no, date_bs, total_paisa
            FROM purchases WHERE supplier_id = ?
           ORDER BY date_ad DESC, created_at DESC LIMIT ?`,
    args: [supplierId, limit],
  });
  return res.rows.map((r) => ({
    id: r.id as string,
    label: [
      r.supplier_invoice_no ? `Bill #${r.supplier_invoice_no as string}` : ((r.purchase_no as string | null) ?? "Purchase"),
      r.date_bs as string,
      formatPaisa(Number(r.total_paisa)),
    ].join(" · "),
  }));
}

export interface LedgerEntry {
  dateBs: string;
  dateAd: string;
  kind: "purchase" | "purchase_return" | "payment" | "opening";
  description: string;
  /** +increases what we owe (purchase); -reduces (return, payment) */
  deltaPaisa: number;
  balancePaisa: number;
}

/**
 * Party ledger: purchases increase the balance we owe; returns and payments reduce it.
 * Returns entries oldest-first with a running balance.
 */
export async function supplierLedger(supplierId: string): Promise<{
  entries: LedgerEntry[];
  balancePaisa: number;
}> {
  const rows: Omit<LedgerEntry, "balancePaisa">[] = [];

  const purchases = await db().execute({
    sql: `SELECT date_ad, date_bs, total_paisa, supplier_invoice_no
          FROM purchases WHERE supplier_id = ?`,
    args: [supplierId],
  });
  for (const p of purchases.rows) {
    rows.push({
      dateAd: p.date_ad as string,
      dateBs: p.date_bs as string,
      kind: "purchase",
      description: `Purchase ${p.supplier_invoice_no ? "#" + p.supplier_invoice_no : ""}`.trim(),
      deltaPaisa: Number(p.total_paisa),
    });
  }

  const returns = await db().execute({
    sql: `SELECT date_ad, date_bs, total_paisa, reason
          FROM purchase_returns WHERE supplier_id = ?`,
    args: [supplierId],
  });
  for (const r of returns.rows) {
    rows.push({
      dateAd: r.date_ad as string,
      dateBs: r.date_bs as string,
      kind: "purchase_return",
      description: `Return${r.reason ? " (" + r.reason + ")" : ""}`,
      deltaPaisa: -Number(r.total_paisa),
    });
  }

  const payments = await db().execute({
    sql: `SELECT sp.date_ad, sp.date_bs, sp.amount_paisa, sp.method, sp.note, sp.transfer_charge_paisa,
                 p.supplier_invoice_no, p.purchase_no
          FROM supplier_payments sp LEFT JOIN purchases p ON p.id = sp.purchase_id
          WHERE sp.supplier_id = ?`,
    args: [supplierId],
  });
  for (const p of payments.rows) {
    const note = ((p.note as string | null) ?? "").trim();
    const forBill = p.supplier_invoice_no ? `for bill #${p.supplier_invoice_no}` : p.purchase_no ? `for ${p.purchase_no}` : "";
    const charge = Number(p.transfer_charge_paisa ?? 0);
    rows.push({
      dateAd: p.date_ad as string,
      dateBs: p.date_bs as string,
      kind: "payment",
      // The note says which purchase a payment made at the time belongs to.
      description: [
        `Payment (${p.method})`,
        forBill,
        note,
        charge > 0 ? `transfer charge ${formatPaisa(charge)} (not owed to the supplier)` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      deltaPaisa: -Number(p.amount_paisa),
    });
  }

  // What was already owed when the books started here (Accounts → Opening).
  for (const o of await openingMoves("supplier", supplierId)) {
    rows.push({ dateAd: o.dateAd, dateBs: o.dateBs, kind: "opening", description: o.description, deltaPaisa: o.deltaPaisa });
  }

  rows.sort((a, b) => (a.dateAd < b.dateAd ? -1 : a.dateAd > b.dateAd ? 1 : 0));

  let balance = 0;
  const entries: LedgerEntry[] = rows.map((r) => {
    balance += r.deltaPaisa;
    return { ...r, balancePaisa: balance };
  });

  return { entries, balancePaisa: balance };
}

/** Just the outstanding balance (what the pharmacy owes the supplier). */
export async function supplierBalance(supplierId: string): Promise<number> {
  const { balancePaisa } = await supplierLedger(supplierId);
  return balancePaisa;
}
