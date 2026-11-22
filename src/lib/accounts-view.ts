/**
 * accounts-view.ts — how the Accounts screens say things. Pure, client-safe.
 */
import { adFromIso, bsToDbText, toBS } from "@/lib/bs";
import { formatPaisa } from "@/lib/money";
import type { PartyType } from "@/lib/accounting";

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
  voucher: "Voucher",
  voucher_cancel: "Voucher cancelled",
  advance_receipt: "Advance taken",
  advance_refund: "Advance handed back",
};

/** Where a party's statement lives. */
export function partyHref(partyType: PartyType, partyId: string): string {
  return `/accounts/parties/${partyType}/${encodeURIComponent(partyId)}`;
}
