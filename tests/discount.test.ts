/**
 * The bill discount, in rupees or as a percentage of the bill.
 */
import { describe, it, expect } from "vitest";
import { resolveBillDiscount, clampPercent, counterTotals } from "@/lib/discount";
import type { ServiceLine } from "@/lib/bill-calc";

function service(ratePaisa: number, vatApplicable = false): ServiceLine {
  return {
    lineId: `s${ratePaisa}`,
    serviceId: "svc",
    name: "ECG",
    groupId: "g",
    qty: 1,
    ratePaisa,
    rateOverridden: false,
    discountPaisa: 0,
    vatApplicable,
    doctorId: null,
    labPartnerId: null,
    followupApplied: false,
    followupNote: "",
  };
}

describe("counterTotals", () => {
  const plain = { vatRegistered: false, roundingOn: false };

  it("takes a percentage off the whole bill", () => {
    const t = counterTotals([], [service(45_000), service(900)], { mode: "percent", amountPaisa: 0, percent: 10 }, plain);
    expect(t.subtotalPaisa).toBe(45_900);
    expect(t.billDiscountPaisa).toBe(4_590);
    expect(t.totalPaisa).toBe(41_310);
  });

  it("is the old rupee discount when the mode is rupees", () => {
    const t = counterTotals([], [service(45_900)], { mode: "amount", amountPaisa: 900, percent: 50 }, plain);
    expect(t.billDiscountPaisa).toBe(900);
    expect(t.totalPaisa).toBe(45_000);
  });

  it("computes VAT on what is left after the percentage", () => {
    const t = counterTotals([], [service(10_000, true)], { mode: "percent", amountPaisa: 0, percent: 10 }, { vatRegistered: true, roundingOn: false });
    expect(t.billDiscountPaisa).toBe(1_000);
    expect(t.vatPaisa).toBe(1_170); // 13% of 9,000
    expect(t.totalPaisa).toBe(10_170);
  });
});

describe("resolveBillDiscount", () => {
  it("takes a rupee discount exactly as typed", () => {
    expect(resolveBillDiscount(45_900, "amount", 5_000, 0)).toBe(5_000);
    expect(resolveBillDiscount(45_900, "amount", 0, 10)).toBe(0);
  });

  it("works a percentage out of the subtotal, to the paisa", () => {
    // 10% of Rs 459 = Rs 45.90
    expect(resolveBillDiscount(45_900, "percent", 0, 10)).toBe(4_590);
    // 2.5% of Rs 459 = Rs 11.475 -> Rs 11.48
    expect(resolveBillDiscount(45_900, "percent", 0, 2.5)).toBe(1_148);
  });

  it("follows the bill when it changes", () => {
    expect(resolveBillDiscount(10_000, "percent", 0, 10)).toBe(1_000);
    expect(resolveBillDiscount(12_000, "percent", 0, 10)).toBe(1_200);
  });

  it("never takes off more than the bill", () => {
    expect(resolveBillDiscount(10_000, "percent", 0, 150)).toBe(10_000);
    expect(resolveBillDiscount(10_000, "percent", 0, 100)).toBe(10_000);
  });

  it("ignores nonsense", () => {
    expect(resolveBillDiscount(10_000, "percent", 0, -5)).toBe(0);
    expect(resolveBillDiscount(10_000, "percent", 0, Number.NaN)).toBe(0);
    expect(resolveBillDiscount(10_000, "amount", -500, 0)).toBe(0);
    expect(resolveBillDiscount(0, "percent", 0, 10)).toBe(0);
  });
});

describe("clampPercent", () => {
  it("keeps 0 to 100, two decimals", () => {
    expect(clampPercent(12.345)).toBe(12.35);
    expect(clampPercent(101)).toBe(100);
    expect(clampPercent(-1)).toBe(0);
  });
});

describe("the inclusive percentage (0036, owner 2083-08-10)", () => {
  it("takes the sub total back to the net that, plus the percentage, makes it: x + 10% = 100", () => {
    // 100.00 → net 90.91, discount 9.09
    expect(resolveBillDiscount(10_000, "percent", 0, 10, "inclusive")).toBe(909);
    // 4,000.00 at 10% → net 3,636.36, discount 363.64
    expect(resolveBillDiscount(400_000, "percent", 0, 10, "inclusive")).toBe(36_364);
    // net + its percentage is the sub total again, to the paisa
    const net = 400_000 - 36_364;
    expect(Math.round(net * 1.1)).toBe(400_000);
  });

  it("leaves rupees typed as they are, and 0% as no discount", () => {
    expect(resolveBillDiscount(10_000, "amount", 500, 10, "inclusive")).toBe(500);
    expect(resolveBillDiscount(10_000, "percent", 0, 0, "inclusive")).toBe(0);
  });

  it("is not used unless chosen: the default is still a percentage of the sub total", () => {
    expect(resolveBillDiscount(10_000, "percent", 0, 10)).toBe(1_000);
    const plain = { vatRegistered: false, roundingOn: false };
    expect(counterTotals([], [service(10_000)], { mode: "percent", amountPaisa: 0, percent: 10 }, plain).totalPaisa).toBe(9_000);
    expect(
      counterTotals([], [service(10_000)], { mode: "percent", amountPaisa: 0, percent: 10, method: "inclusive" }, plain).totalPaisa,
    ).toBe(9_091);
  });
});
