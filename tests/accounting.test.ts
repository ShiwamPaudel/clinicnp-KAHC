import { describe, it, expect } from "vitest";
import {
  ageItems,
  bucketOf,
  checkVoucher,
  naturalBalance,
  openItemsOldestFirst,
  openingBalancingLine,
  shareDiscount,
  voucherNoLabel,
  type AccountFacts,
  type VoucherLineInput,
} from "@/lib/accounting";

const ACCOUNTS: Record<string, AccountFacts> = {
  cash: { id: "cash", kind: "asset", grp: "cash_bank", active: true, isControl: false, autoOnly: false },
  bank: { id: "bank", kind: "asset", grp: "cash_bank", active: true, isControl: false, autoOnly: false },
  rent: { id: "rent", kind: "expense", grp: "indirect_expense", active: true, isControl: false, autoOnly: false },
  sales: { id: "sales", kind: "income", grp: "direct_income", active: true, isControl: false, autoOnly: false },
  stock: { id: "stock", kind: "asset", grp: "stock", active: true, isControl: false, autoOnly: true },
  doctors: { id: "doctors", kind: "liability", grp: "payable", active: true, isControl: true, autoOnly: false },
  off: { id: "off", kind: "expense", grp: "indirect_expense", active: false, isControl: false, autoOnly: false },
};
const byId = (id: string) => ACCOUNTS[id];
const party = () => "doctors";

const line = (accountId: string, dr: number, cr: number, extra: Partial<VoucherLineInput> = {}): VoucherLineInput => ({
  accountId,
  partyType: null,
  partyId: null,
  debitPaisa: dr,
  creditPaisa: cr,
  ...extra,
});

describe("checkVoucher", () => {
  it("takes a payment from cash to an expense", () => {
    expect(checkVoucher("payment", [line("rent", 500, 0), line("cash", 0, 500)], byId, party)).toBe(500);
  });
  it("wants both sides equal", () => {
    expect(() => checkVoucher("journal", [line("rent", 500, 0), line("cash", 0, 400)], byId, party)).toThrow(/same amount/);
  });
  it("wants a payment to come out of cash or bank", () => {
    expect(() => checkVoucher("payment", [line("rent", 500, 0), line("sales", 0, 500)], byId, party)).toThrow(/paid from/);
  });
  it("wants a receipt to go into cash or bank", () => {
    expect(() => checkVoucher("receipt", [line("rent", 500, 0), line("sales", 0, 500)], byId, party)).toThrow(/went into/);
  });
  it("keeps a transfer between cash and bank", () => {
    expect(checkVoucher("contra", [line("bank", 500, 0), line("cash", 0, 500)], byId, party)).toBe(500);
    expect(() => checkVoucher("contra", [line("rent", 500, 0), line("cash", 0, 500)], byId, party)).toThrow(/only between cash and bank/);
  });
  it("never lets stock be touched by hand", () => {
    expect(() => checkVoucher("journal", [line("stock", 500, 0), line("cash", 0, 500)], byId, party)).toThrow(/Medicine stock/);
  });
  it("wants a person on a control account, and only doctors or other parties outside openings", () => {
    expect(() => checkVoucher("payment", [line("doctors", 500, 0), line("cash", 0, 500)], byId, party)).toThrow(/who the money is for/);
    expect(
      checkVoucher("payment", [line("doctors", 500, 0, { partyType: "doctor", partyId: "d1" }), line("cash", 0, 500)], byId, party),
    ).toBe(500);
    expect(() =>
      checkVoucher("payment", [line("doctors", 500, 0, { partyType: "supplier", partyId: "s1" }), line("cash", 0, 500)], byId, party),
    ).toThrow(/own pages/);
  });
  it("refuses a switched-off account, a line both ways, and a negative", () => {
    expect(() => checkVoucher("journal", [line("off", 500, 0), line("cash", 0, 500)], byId, party)).toThrow(/switched off/);
    expect(() => checkVoucher("journal", [line("rent", 500, 500), line("cash", 0, 500)], byId, party)).toThrow(/not both/);
    expect(() => checkVoucher("journal", [line("rent", -5, 0), line("cash", 0, 500)], byId, party)).toThrow(/more than zero/);
  });
  it("lets an opening stand on one line, but not hold income", () => {
    expect(checkVoucher("opening", [line("cash", 1000, 0)], byId, party)).toBe(1000);
    expect(() => checkVoucher("opening", [line("sales", 0, 1000)], byId, party)).toThrow(/not income or expenses/);
  });
});

describe("openingBalancingLine", () => {
  it("puts the difference on opening balances", () => {
    expect(openingBalancingLine([line("cash", 1000, 0), line("doctors", 0, 300)])).toMatchObject({
      accountId: "sys:opening",
      debitPaisa: 0,
      creditPaisa: 700,
    });
    expect(openingBalancingLine([line("cash", 500, 0), line("doctors", 0, 500)])).toBeNull();
  });
});

describe("openItemsOldestFirst", () => {
  it("clears the oldest bill first and keeps an advance", () => {
    const r = openItemsOldestFirst([
      { dateAd: "2026-08-01", amountPaisa: 1000, ref: "A" },
      { dateAd: "2026-09-01", amountPaisa: 2000, ref: "B" },
      { dateAd: "2026-09-05", amountPaisa: -1500, ref: "pay" },
    ]);
    expect(r.items).toEqual([{ dateAd: "2026-09-01", ref: "B", originalPaisa: 2000, openPaisa: 1500 }]);
    expect(r.advancePaisa).toBe(0);
    const over = openItemsOldestFirst([
      { dateAd: "2026-08-01", amountPaisa: 1000, ref: "A" },
      { dateAd: "2026-08-02", amountPaisa: -1500, ref: "pay" },
      { dateAd: "2026-08-03", amountPaisa: 200, ref: "C" },
    ]);
    // the Rs 5 paid ahead is used up by the next bill
    expect(over.items).toEqual([]);
    expect(over.advancePaisa).toBe(-300);
  });
});

describe("aging", () => {
  it("buckets from the bill date", () => {
    expect(bucketOf(0)).toBe("d0");
    expect(bucketOf(30)).toBe("d0");
    expect(bucketOf(31)).toBe("d31");
    expect(bucketOf(120)).toBe("d91");
    expect(bucketOf(121)).toBe("d121");
    expect(ageItems([{ dateAd: "2026-10-01", openPaisa: 100 }, { dateAd: "2026-06-01", openPaisa: 50 }], "2026-11-19")).toEqual({
      d0: 0, d31: 100, d61: 0, d91: 0, d121: 50,
    });
  });
});

describe("shareDiscount", () => {
  it("adds up to the discount exactly", () => {
    const s = shareDiscount(1000, [2000, 50000, 0, 0], 1);
    expect(s).toEqual([38, 962, 0, 0]);
    expect(shareDiscount(0, [1, 2], 0)).toEqual([0, 0]);
  });
});

describe("labels", () => {
  it("numbers and natural balances", () => {
    expect(voucherNoLabel("payment", "2083/84", 7)).toBe("PV-2083/84-0007");
    expect(naturalBalance("asset", 500, 200)).toBe(300);
    expect(naturalBalance("liability", 500, 200)).toBe(-300);
  });
});
