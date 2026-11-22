/**
 * prebooking-format.ts — labels for pre-bookings and their advances. Pure and
 * client-safe.
 */

export type PrebookingKind = "tests" | "consultation";
export type PrebookingStatus = "booked" | "billed" | "cancelled" | "missed";

export const PREBOOKING_STATUS_LABEL: Record<PrebookingStatus, string> = {
  booked: "Booked",
  billed: "Billed",
  cancelled: "Cancelled",
  missed: "Did not come",
};

/** AR-000001: an advance receipt's number. */
export function advanceReceiptLabel(no: number | null | undefined): string {
  return no == null ? "Advance" : `AR-${String(no).padStart(6, "0")}`;
}

/**
 * What an advance does to a bill: how much of it the bill uses, what is left
 * to pay, and what is handed back when the advance was more than the bill.
 */
export function advanceAgainst(totalPaisa: number, advancePaisa: number): {
  usedPaisa: number;
  toPayPaisa: number;
  handBackPaisa: number;
} {
  const advance = Math.max(0, advancePaisa);
  const total = Math.max(0, totalPaisa);
  const used = Math.min(advance, total);
  return { usedPaisa: used, toPayPaisa: total - used, handBackPaisa: advance - used };
}
