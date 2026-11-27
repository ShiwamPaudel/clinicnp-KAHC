/**
 * Accounts in plain words (owner, 2083-08-11): the money columns and balances
 * say what happened, never Debit / Credit or Dr / Cr.
 */
import { describe, it, expect } from "vitest";
import { accountSides, MIXED_SIDES, partyBalance, partySides, plainBalance, SOURCE_LABEL } from "@/lib/accounts-view";
import { KIND_LABEL, VOUCHER_LABEL } from "@/lib/accounting";

describe("the money columns", () => {
  it("say what the money did to the account, in debit, credit order", () => {
    expect(accountSides("asset", "cash_bank")).toEqual(["Money in", "Money out"]);
    expect(accountSides("expense", "indirect_expense")).toEqual(["Spent", "Taken back"]);
    expect(accountSides("income", "direct_income")).toEqual(["Taken back", "Earned"]);
    expect(accountSides("liability", "duty_tax")).toEqual(MIXED_SIDES);
    expect(MIXED_SIDES).toEqual(["In", "Out"]);
  });

  it("on a person's statement, put Owed on the side that adds to what is owed", () => {
    expect(partySides(true)).toEqual(["Owed", "Paid"]); // a patient: the bill is the debit
    expect(partySides(false)).toEqual(["Paid", "Owed"]); // a supplier: the purchase is the credit
  });
});

describe("a balance", () => {
  it("is stated the way the account grows, with a minus when it has turned", () => {
    expect(plainBalance(150_000, "asset")).toBe("1,500.00"); // cash in hand
    expect(plainBalance(-20_000, "asset")).toBe("−200.00"); // overdrawn
    expect(plainBalance(30_000, "expense")).toBe("300.00"); // tea spent
    expect(plainBalance(-120_000, "income")).toBe("1,200.00"); // earned
    expect(plainBalance(0, "income")).toBe("0.00");
  });

  it("with a person, says whether the clinic receives or pays", () => {
    expect(partyBalance(50_000)).toBe("500.00 to receive");
    expect(partyBalance(-75_000)).toBe("750.00 to pay");
    expect(partyBalance(0)).toBe("0.00");
  });
});

describe("the words on the Accounts screens", () => {
  it("leave out the bookkeeping terms", () => {
    const all = [...Object.values(VOUCHER_LABEL), ...Object.values(KIND_LABEL), SOURCE_LABEL.voucher, SOURCE_LABEL.voucher_cancel];
    for (const w of all) expect(w).not.toMatch(/voucher|journal|receipt|liabilit|assets|capital|debit|credit/i);
    expect(VOUCHER_LABEL).toEqual({
      payment: "Expense",
      receipt: "Money received",
      contra: "Cash ↔ bank",
      journal: "Adjustment",
      opening: "Starting balances",
    });
  });
});
