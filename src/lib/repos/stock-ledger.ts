/**
 * stock-ledger.ts — one medicine's stock between two dates (owner, 2083-08-09):
 * what was there at the start, every movement in and out, and what was left.
 *
 * Read from `stock_moves` alone, the same ledger every stock screen trusts:
 * opening = every move before the first day; closing = opening + the moves in
 * the range. Days are Nepal days (a move at 11:50 PM belongs to that day, not
 * to the next one in UTC). Quantities are base units; the page shows them in
 * the item's packs.
 */
import "server-only";
import { db } from "@/lib/db";
import type { StockMoveReason } from "@/lib/repos/batches";

/** The UTC instant a Nepal calendar day (AD "YYYY-MM-DD") starts. */
export function nepalDayStartUtc(adIso: string): string {
  return new Date(`${adIso}T00:00:00+05:45`).toISOString();
}

/** The day after an AD date, as "YYYY-MM-DD". */
function nextDay(adIso: string): string {
  const d = new Date(`${adIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export type LedgerGroup =
  | "opening_entry"
  | "purchase"
  | "sale_return"
  | "bill_cancel"
  | "sale"
  | "purchase_return"
  | "stock_out"
  | "correction";

export const LEDGER_GROUP_LABEL: Record<LedgerGroup, string> = {
  opening_entry: "Opening stock entered",
  purchase: "Purchases",
  sale_return: "Sale returns",
  bill_cancel: "Cancelled bills",
  sale: "Sales",
  purchase_return: "Purchase returns",
  stock_out: "Stock out",
  correction: "Count corrections",
};

const STOCK_OUT_LABEL: Partial<Record<StockMoveReason, string>> = {
  returned_to_supplier: "Returned to supplier",
  disposed: "Expired (disposed)",
  damaged: "Damaged or broken",
  lost: "Lost",
  clinic_use: "Clinic use",
  sample: "Sample",
  write_off: "Written off",
  count_correction: "Count correction",
  adjustment: "Adjustment",
};

function groupOf(reason: StockMoveReason, refTable: string | null): LedgerGroup {
  if (reason === "opening") return "opening_entry";
  if (reason === "purchase") return "purchase";
  if (reason === "sale") return "sale";
  if (reason === "sale_return") return "sale_return";
  if (reason === "purchase_return") return "purchase_return";
  if (reason === "adjustment" && refTable === "bill_cancel") return "bill_cancel";
  if (reason === "count_correction" || reason === "adjustment") return "correction";
  return "stock_out";
}

export interface LedgerLine {
  at: string;
  group: LedgerGroup;
  /** "Sale", "Purchase", "Stock out: Damaged or broken" */
  particulars: string;
  /** the document behind it: bill 000012, PI-2083/84-000003, SO-… */
  docNo: string;
  party: string;
  batchNo: string;
  inBase: number;
  outBase: number;
  balanceBase: number;
}

export interface StockLedger {
  openingBase: number;
  closingBase: number;
  inBase: number;
  outBase: number;
  /** each kind of movement, net, in a fixed order; only those that happened */
  groups: { group: LedgerGroup; label: string; inBase: number; outBase: number }[];
  lines: LedgerLine[];
}

const ORDER: LedgerGroup[] = ["opening_entry", "purchase", "sale_return", "bill_cancel", "sale", "purchase_return", "stock_out", "correction"];

export async function stockLedger(itemId: string, fromAd: string, toAd: string): Promise<StockLedger> {
  const start = nepalDayStartUtc(fromAd);
  const end = nepalDayStartUtc(nextDay(toAd));
  const [openRes, movesRes] = await Promise.all([
    db().execute({
      sql: "SELECT IFNULL(SUM(base_qty_delta), 0) AS q FROM stock_moves WHERE item_id = ? AND at < ?",
      args: [itemId, start],
    }),
    db().execute({
      sql: `SELECT m.at, m.reason, m.base_qty_delta, m.ref_table, b.batch_no,
                   CASE m.ref_table
                     WHEN 'bills' THEN (SELECT printf('%06d', x.invoice_no) FROM bills x WHERE x.id = m.ref_id AND x.invoice_no IS NOT NULL)
                     WHEN 'bill_cancel' THEN (SELECT printf('%06d', x.invoice_no) FROM bills x WHERE x.id = m.ref_id AND x.invoice_no IS NOT NULL)
                     WHEN 'purchases' THEN (SELECT x.purchase_no FROM purchases x WHERE x.id = m.ref_id)
                     WHEN 'purchase_returns' THEN (SELECT x.return_no FROM purchase_returns x WHERE x.id = m.ref_id)
                     WHEN 'sale_returns' THEN (
                       SELECT 'SR-' || IFNULL(f.bs_label, '') || '-' || printf('%06d', sr.return_no)
                         FROM sale_returns sr JOIN bills bb ON bb.id = sr.bill_id
                         LEFT JOIN fiscal_years f ON f.id = bb.fiscal_year_id
                        WHERE sr.id = m.ref_id AND sr.return_no IS NOT NULL)
                     WHEN 'stock_adjustments' THEN (
                       SELECT 'SO-' || IFNULL(f.bs_label, '') || '-' || printf('%06d', a.adjustment_no)
                         FROM stock_adjustments a LEFT JOIN fiscal_years f ON f.id = a.fiscal_year_id
                        WHERE a.id = m.ref_id AND a.adjustment_no IS NOT NULL)
                   END AS doc_no,
                   CASE m.ref_table
                     WHEN 'purchases' THEN (SELECT s.name FROM purchases x JOIN suppliers s ON s.id = x.supplier_id WHERE x.id = m.ref_id)
                     WHEN 'purchase_returns' THEN (SELECT s.name FROM purchase_returns x JOIN suppliers s ON s.id = x.supplier_id WHERE x.id = m.ref_id)
                   END AS party
              FROM stock_moves m
              JOIN batches b ON b.id = m.batch_id
             WHERE m.item_id = ? AND m.at >= ? AND m.at < ?
             ORDER BY m.at, m.rowid`,
      args: [itemId, start, end],
    }),
  ]);

  const openingBase = Number(openRes.rows[0]?.q ?? 0);
  let balance = openingBase;
  const totals = new Map<LedgerGroup, { inBase: number; outBase: number }>();
  const lines: LedgerLine[] = movesRes.rows.map((r) => {
    const reason = r.reason as StockMoveReason;
    const refTable = (r.ref_table as string | null) ?? null;
    const delta = Number(r.base_qty_delta);
    const group = groupOf(reason, refTable);
    balance += delta;
    const t = totals.get(group) ?? { inBase: 0, outBase: 0 };
    if (delta >= 0) t.inBase += delta;
    else t.outBase += -delta;
    totals.set(group, t);
    const particulars =
      group === "stock_out"
        ? `Stock out: ${STOCK_OUT_LABEL[reason] ?? reason}`
        : group === "correction"
          ? STOCK_OUT_LABEL[reason] ?? "Adjustment"
          : group === "bill_cancel"
            ? "Bill cancelled"
            : group === "opening_entry"
              ? "Opening stock"
              : LEDGER_GROUP_LABEL[group].replace(/s$/, "");
    return {
      at: r.at as string,
      group,
      particulars,
      docNo: (r.doc_no as string | null) ?? "",
      party: (r.party as string | null) ?? "",
      batchNo: (r.batch_no as string) ?? "",
      inBase: delta > 0 ? delta : 0,
      outBase: delta < 0 ? -delta : 0,
      balanceBase: balance,
    };
  });

  const groups = ORDER.filter((g) => totals.has(g)).map((g) => ({ group: g, label: LEDGER_GROUP_LABEL[g], ...totals.get(g)! }));
  const inBase = groups.reduce((s, g) => s + g.inBase, 0);
  const outBase = groups.reduce((s, g) => s + g.outBase, 0);
  return { openingBase, closingBase: openingBase + inBase - outBase, inBase, outBase, groups, lines };
}
