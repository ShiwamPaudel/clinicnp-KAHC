/**
 * party-openings.ts — what a supplier or outside laboratory was already owed
 * when the clinic started keeping its books here (opening vouchers, 0025).
 *
 * The supplier page, the laboratory statement and Payables read these too,
 * so a balance carried in from the old books shows everywhere the same way.
 * A cancelled opening is undone on the day it was cancelled.
 */
import "server-only";
import { db } from "@/lib/db";

export type OpeningPartyType = "supplier" | "lab_partner";

export interface OpeningMove {
  dateAd: string;
  dateBs: string;
  /** + more is owed to them, − less */
  deltaPaisa: number;
  description: string;
}

/** Opening entries for one party between two dates (AD, inclusive). */
export async function openingMoves(
  partyType: OpeningPartyType,
  partyId: string,
  fromIso = "0001-01-01",
  toIso = "9999-12-31",
): Promise<OpeningMove[]> {
  const res = await db().execute({
    sql: `SELECT v.date_ad, v.date_bs, vl.credit_paisa - vl.debit_paisa AS delta, vl.ref_no, 0 AS undo
            FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id
           WHERE vl.party_type = ? AND vl.party_id = ? AND v.date_ad BETWEEN ? AND ?
          UNION ALL
          SELECT v.cancel_date_ad, v.cancel_date_bs, vl.debit_paisa - vl.credit_paisa, vl.ref_no, 1
            FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id
           WHERE vl.party_type = ? AND vl.party_id = ? AND v.status = 'cancelled'
             AND v.cancel_date_ad BETWEEN ? AND ?
           ORDER BY 1`,
    args: [partyType, partyId, fromIso, toIso, partyType, partyId, fromIso, toIso],
  });
  return res.rows
    .filter((r) => Number(r.delta) !== 0)
    .map((r) => {
      const ref = ((r.ref_no as string | null) ?? "").trim();
      const base = ref ? `Opening balance · bill ${ref}` : "Opening balance";
      return {
        dateAd: r.date_ad as string,
        dateBs: r.date_bs as string,
        deltaPaisa: Number(r.delta),
        description: Number(r.undo) === 1 ? `${base} (cancelled)` : base,
      };
    });
}

/** What the openings add up to before a date (or in all, when no date). */
export async function openingTotal(partyType: OpeningPartyType, partyId: string, beforeIso?: string): Promise<number> {
  const moves = await openingMoves(partyType, partyId, "0001-01-01", beforeIso ? dayBeforeIso(beforeIso) : "9999-12-31");
  return moves.reduce((s, m) => s + m.deltaPaisa, 0);
}

/**
 * SQL for the openings of `idExpr` (a supplier or laboratory id column) as a
 * single figure, everything to date. For list queries.
 */
export function openingSumSql(partyType: OpeningPartyType, idExpr: string): string {
  return `COALESCE((SELECT SUM(vl.credit_paisa - vl.debit_paisa)
                      FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id
                     WHERE vl.party_type = '${partyType}' AND vl.party_id = ${idExpr}
                       AND v.status = 'posted'), 0)`;
}

function dayBeforeIso(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
