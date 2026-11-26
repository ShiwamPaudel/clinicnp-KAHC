/**
 * discount.ts — the bill discount, typed either as rupees or as a percentage.
 *
 * A percentage is always of the bill as it stands, so it is worked out again
 * whenever a line changes rather than frozen at the moment it was typed: 10%
 * of a bill that then grows by a strip is still 10%. What reaches the server
 * is the rupee figure this returns, the same as a discount typed in rupees.
 *
 * Pure and client-safe. Money is integer paisa (Rules §1.2); the percentage
 * itself may carry decimals (2.5%).
 */
import { percentDiscount } from "@/lib/money";
import {
  billTotals,
  type BillConfig,
  type BillLine,
  type BillTotals,
  type ServiceLine,
} from "@/lib/bill-calc";

export type DiscountMode = "amount" | "percent";

/**
 * How a percentage becomes rupees on a bill (0036, owner 2083-08-10), set in
 * Settings → Company → Bill discount:
 * - "of_subtotal" (as it always was): 10% of 100 = 10, net 90.
 * - "inclusive": the net is the amount that, with the percentage added, makes
 *   the sub total: x + 10% = 100, so x = 100 / 1.10 = 90.91, discount 9.09.
 */
export type PercentDiscountMethod = "of_subtotal" | "inclusive";

export function isPercentDiscountMethod(v: unknown): v is PercentDiscountMethod {
  return v === "of_subtotal" || v === "inclusive";
}

/** A percentage the counter will accept: 0 to 100, at most two decimals. */
export function clampPercent(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.min(100, Math.round(percent * 100) / 100);
}

/**
 * The bill discount in paisa.
 *
 * In rupees it is exactly what was typed, as it always has been. As a
 * percentage it is that share of the subtotal, rounded to the paisa, and so can
 * never be more than the bill; with the "inclusive" method it is what is left
 * after taking the subtotal back to the amount that, plus the percentage, makes
 * the subtotal (the net rounded to the paisa, the discount the rest).
 */
export function resolveBillDiscount(
  subtotalPaisa: number,
  mode: DiscountMode,
  amountPaisa: number,
  percent: number,
  method: PercentDiscountMethod = "of_subtotal",
): number {
  if (mode === "percent") {
    const base = Math.max(0, subtotalPaisa);
    const p = clampPercent(percent);
    if (method === "inclusive") {
      if (p === 0) return 0;
      const net = Math.round((base * 100) / (100 + p));
      return base - net;
    }
    return percentDiscount(base, p);
  }
  return Math.max(0, Math.trunc(amountPaisa));
}

/**
 * The bill's totals with its discount worked out, for the counter. The payment
 * panel shows these and the save sends them, so the two cannot disagree.
 */
export function counterTotals(
  lines: BillLine[],
  serviceLines: ServiceLine[],
  discount: { mode: DiscountMode; amountPaisa: number; percent: number; method?: PercentDiscountMethod },
  cfg: BillConfig,
): BillTotals {
  const subtotal = billTotals(lines, 0, cfg, serviceLines).subtotalPaisa;
  const off = resolveBillDiscount(
    subtotal,
    discount.mode,
    discount.amountPaisa,
    discount.percent,
    discount.method ?? "of_subtotal",
  );
  return billTotals(lines, off, cfg, serviceLines);
}
