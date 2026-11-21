/**
 * invoice-number.ts — formats the fiscal-year document numbers.
 * Sales bill: 000123 — plain digits, as the printed tax invoice carries them;
 * the bill's date says which fiscal year it belongs to (owner, 2083-08-05).
 * Sales return: SR-2083/84-000007 · Purchase: PI-2083/84-000042.
 * The sequence VALUE is assigned server-side, transactionally (never on the client).
 */

export type NumberKind = "SI" | "SR" | "PI";

/** Format a sequence into its document number. */
export function formatDocNo(
  kind: NumberKind,
  fiscalLabel: string,
  seq: number,
): string {
  const digits = String(seq).padStart(6, "0");
  return kind === "SI" ? digits : `${kind}-${fiscalLabel}-${digits}`;
}

/**
 * Parse a prefixed number back to its parts (or null if it doesn't match).
 * A sales bill's plain number carries no fiscal year, so only the prefixed
 * forms parse (including SI-… from before bills went plain).
 */
export function parseDocNo(
  value: string,
): { kind: NumberKind; fiscalLabel: string; seq: number } | null {
  const m = /^(SI|SR|PI)-(\d{4}\/\d{2})-(\d{6})$/.exec(value);
  if (!m) return null;
  return {
    kind: m[1] as NumberKind,
    fiscalLabel: m[2]!,
    seq: Number(m[3]),
  };
}
