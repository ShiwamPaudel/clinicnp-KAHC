/**
 * accounts-view.ts — how the Accounts screens say things. Pure, client-safe.
 */
import { adFromIso, bsToDbText, toBS } from "@/lib/bs";
import { formatPaisa } from "@/lib/money";
import { naturalBalance, type AccountKind, type PartyType } from "@/lib/accounting";

/** An AD ISO date as BS text, "2083-08-03". */
export function bsOf(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return bsToDbText(toBS(adFromIso(iso)));
  } catch {
    return "";
  }
}

/** A debit-minus-credit balance as "1,234.00 Dr" / "1,234.00 Cr". */
export function drCr(paisa: number): string {
  if (paisa === 0) return "0.00";
  return `${formatPaisa(Math.abs(paisa), false)} ${paisa > 0 ? "Dr" : "Cr"}`;
}

/**
 * The two money columns in plain words (owner, 2083-08-11), in debit, credit
 * order. One account's history says what the money did to that account; a
 * screen that mixes accounts (an entry, the Daily list) says In / Out.
 */
export const MIXED_SIDES: readonly [string, string] = ["In", "Out"];

export function accountSides(kind: AccountKind, grp: string): readonly [string, string] {
  if (grp === "cash_bank") return ["Money in", "Money out"];
  if (kind === "expense") return ["Spent", "Taken back"];
  if (kind === "income") return ["Taken back", "Earned"];
  return MIXED_SIDES;
}

/**
 * A person's statement: "Owed" is what adds to the balance between them and
 * the clinic, "Paid" what settles it. Patients and customers owe on the
 * debit side; suppliers, laboratories and doctors are owed on the credit side.
 */
export function partySides(clinicIsOwed: boolean): readonly [string, string] {
  return clinicIsOwed ? ["Owed", "Paid"] : ["Paid", "Owed"];
}

/** A debit-minus-credit balance as the account itself states it; minus when it has turned the other way. */
export function plainBalance(paisa: number, kind: AccountKind): string {
  const n = naturalBalance(kind, paisa > 0 ? paisa : 0, paisa < 0 ? -paisa : 0);
  if (n === 0) return "0.00";
  return `${n < 0 ? "−" : ""}${formatPaisa(Math.abs(n), false)}`;
}

/** A debit-minus-credit balance with a person: what the clinic will receive or pay. */
export function partyBalance(paisa: number): string {
  if (paisa === 0) return "0.00";
  return `${formatPaisa(Math.abs(paisa), false)} ${paisa > 0 ? "to receive" : "to pay"}`;
}

/** Plain money, no symbol, blank for zero. */
export function amountOrBlank(paisa: number): string {
  return paisa === 0 ? "" : formatPaisa(paisa, false);
}

/** What a journal line came from, as the day book says it. */
export const SOURCE_LABEL: Record<string, string> = {
  bill: "Bill",
  bill_cancel: "Bill cancelled",
  return: "Return / refund",
  due_receipt: "Dues paid",
  due_void: "Dues payment undone",
  purchase: "Purchase",
  purchase_return: "Purchase return",
  supplier_payment: "Supplier payment",
  lab_payment: "Laboratory payment",
  lab_sendout: "Test sent out",
  lab_sendout_undo: "Send-out undone",
  stock_out: "Stock out",
  opening_stock: "Opening stock",
  voucher: "Entry",
  voucher_cancel: "Entry cancelled",
  advance_receipt: "Advance taken",
  advance_refund: "Advance handed back",
};

/** Where a party's statement lives. */
export function partyHref(partyType: PartyType, partyId: string): string {
  return `/accounts/parties/${partyType}/${encodeURIComponent(partyId)}`;
}
