/**
 * accounting.ts — the rules of the books, with no database. Pure and
 * client-safe, so the voucher form checks exactly what the server checks.
 *
 * Money is integer paisa (Rules §1.2). A line is a debit or a credit, never
 * both. See prod-docs/Accounting.md.
 */

export type AccountKind = "asset" | "liability" | "equity" | "income" | "expense";

export const ACCOUNT_KINDS: readonly AccountKind[] = ["asset", "liability", "equity", "income", "expense"];

export const KIND_LABEL: Record<AccountKind, string> = {
  asset: "What the clinic owns",
  liability: "What the clinic owes",
  equity: "Owner's money",
  income: "Income",
  expense: "Expenses",
};

/** The heading an account prints under, and the kind it belongs to. */
export const ACCOUNT_GROUPS = {
  cash_bank: { label: "Cash and bank", kind: "asset" },
  receivable: { label: "Money owed to the clinic", kind: "asset" },
  stock: { label: "Stock", kind: "asset" },
  current_asset: { label: "Other things the clinic owns", kind: "asset" },
  fixed_asset: { label: "Equipment, furniture and buildings", kind: "asset" },
  payable: { label: "Money the clinic owes", kind: "liability" },
  duty_tax: { label: "Taxes", kind: "liability" },
  loan: { label: "Loans", kind: "liability" },
  current_liability: { label: "Other amounts the clinic owes", kind: "liability" },
  capital: { label: "Owner's money", kind: "equity" },
  direct_income: { label: "Sales and services", kind: "income" },
  indirect_income: { label: "Other income", kind: "income" },
  direct_expense: { label: "Direct costs", kind: "expense" },
  indirect_expense: { label: "Running costs", kind: "expense" },
} as const satisfies Record<string, { label: string; kind: AccountKind }>;

export type AccountGroup = keyof typeof ACCOUNT_GROUPS;

export function isAccountGroup(v: unknown): v is AccountGroup {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ACCOUNT_GROUPS, v);
}

/**
 * Taxes paid on purchases sit with assets even though the group is shared
 * with taxes owed: an account's own kind wins over its group's.
 */
export function groupsForKind(kind: AccountKind): AccountGroup[] {
  return (Object.keys(ACCOUNT_GROUPS) as AccountGroup[]).filter(
    (g) => ACCOUNT_GROUPS[g].kind === kind || (g === "duty_tax" && kind === "asset"),
  );
}

export type Segment = "pharmacy" | "clinic" | "lab";
export const SEGMENT_LABEL: Record<Segment, string> = {
  pharmacy: "Pharmacy",
  clinic: "Clinic",
  lab: "Laboratory",
};

/** Assets and expenses grow with a debit; everything else with a credit. */
export function debitNormal(kind: AccountKind): boolean {
  return kind === "asset" || kind === "expense";
}

/** A balance as the account would naturally state it: positive is normal. */
export function naturalBalance(kind: AccountKind, debitPaisa: number, creditPaisa: number): number {
  return debitNormal(kind) ? debitPaisa - creditPaisa : creditPaisa - debitPaisa;
}

// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------

export type VoucherType = "receipt" | "payment" | "contra" | "journal" | "opening";

export const VOUCHER_TYPES: readonly VoucherType[] = ["payment", "receipt", "contra", "journal", "opening"];

/** What each kind of entry is called on screen: plain words (owner, 2083-08-11). */
export const VOUCHER_LABEL: Record<VoucherType, string> = {
  payment: "Expense",
  receipt: "Money received",
  contra: "Cash ↔ bank",
  journal: "Adjustment",
  opening: "Starting balances",
};

export const VOUCHER_PREFIX: Record<VoucherType, string> = {
  payment: "PV",
  receipt: "RV",
  contra: "CV",
  journal: "JV",
  opening: "OB",
};

export function isVoucherType(v: unknown): v is VoucherType {
  return typeof v === "string" && (VOUCHER_TYPES as readonly string[]).includes(v);
}

/** "PV-2083/84-0007" */
export function voucherNoLabel(type: VoucherType, fiscalLabel: string, no: number): string {
  return `${VOUCHER_PREFIX[type]}-${fiscalLabel}-${String(no).padStart(4, "0")}`;
}

/** Who a line can name. Patients settle through Dues, never by voucher. */
export type PartyType = "patient" | "walkin" | "supplier" | "lab_partner" | "doctor" | "party";

export const PARTY_TYPE_LABEL: Record<PartyType, string> = {
  patient: "Patient",
  walkin: "Customer",
  supplier: "Supplier",
  lab_partner: "Outside laboratory",
  doctor: "Doctor",
  party: "Other",
};

export function isPartyType(v: unknown): v is PartyType {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PARTY_TYPE_LABEL, v);
}

/** Party types a voucher may name. Openings may also name suppliers and laboratories. */
export function voucherPartyTypes(type: VoucherType): PartyType[] {
  return type === "opening" ? ["supplier", "lab_partner", "doctor", "party"] : ["doctor", "party"];
}

/** The control account every line for a party goes to. */
export function controlAccountFor(partyType: PartyType, partySide: "debtor" | "creditor" = "creditor"): string {
  switch (partyType) {
    case "patient":
    case "walkin":
      return "sys:recv_patients";
    case "supplier":
      return "sys:pay_suppliers";
    case "lab_partner":
      return "sys:pay_labs";
    case "doctor":
      return "sys:pay_doctors";
    case "party":
      return partySide === "debtor" ? "sys:recv_parties" : "sys:pay_parties";
  }
}

/** What the voucher checks need to know about an account. */
export interface AccountFacts {
  id: string;
  kind: AccountKind;
  grp: string;
  active: boolean;
  isControl: boolean;
  autoOnly: boolean;
}

export interface VoucherLineInput {
  accountId: string;
  partyType: PartyType | null;
  partyId: string | null;
  debitPaisa: number;
  creditPaisa: number;
  refNo?: string;
  /** the old bill's date, for an opening balance owed on it (BS text and AD) */
  refDateBs?: string | null;
  refDateAd?: string | null;
  note?: string;
}

/** A voucher that cannot be saved, with a sentence written for the screen. */
export class VoucherProblem extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = "VoucherProblem";
    this.userMessage = userMessage;
  }
}

export function isCashOrBank(a: Pick<AccountFacts, "grp">): boolean {
  return a.grp === "cash_bank";
}

/**
 * Check a voucher before it is saved. Throws VoucherProblem; returns the
 * total (the sum of either side) when it is sound.
 *
 * `partyAccount` resolves the control account a party's line must use (it
 * needs the party's side for other parties, which only the server knows).
 */
export function checkVoucher(
  type: VoucherType,
  lines: VoucherLineInput[],
  accountById: (id: string) => AccountFacts | undefined,
  partyAccount: (partyType: PartyType, partyId: string) => string | undefined,
): number {
  const used = lines.filter((l) => l.debitPaisa !== 0 || l.creditPaisa !== 0);
  if (used.length < (type === "opening" ? 1 : 2)) {
    throw new VoucherProblem(type === "opening" ? "Enter at least one balance." : "An entry needs at least two lines.");
  }
  let dr = 0;
  let cr = 0;
  const allowedParties = voucherPartyTypes(type);
  for (const l of used) {
    if (!Number.isInteger(l.debitPaisa) || !Number.isInteger(l.creditPaisa) || l.debitPaisa < 0 || l.creditPaisa < 0) {
      throw new VoucherProblem("Amounts must be more than zero.");
    }
    if (l.debitPaisa > 0 && l.creditPaisa > 0) {
      throw new VoucherProblem("A line is either paid in or paid out, not both.");
    }
    const acc = accountById(l.accountId);
    if (!acc) throw new VoucherProblem("Choose an account on every line.");
    if (!acc.active) throw new VoucherProblem("One of the accounts has been switched off.");
    if (acc.autoOnly) {
      throw new VoucherProblem("Medicine stock and patients' dues change only through bills, purchases and the Dues screen.");
    }
    if (l.partyType || l.partyId) {
      if (!l.partyType || !l.partyId || !allowedParties.includes(l.partyType)) {
        throw new VoucherProblem(
          type === "opening"
            ? "Choose a supplier, laboratory, doctor or another person or company."
            : "Payments to suppliers and laboratories are recorded on their own pages. Choose a doctor or another person or company.",
        );
      }
      if (partyAccount(l.partyType, l.partyId) !== l.accountId) {
        throw new VoucherProblem("That person was not found. Choose them again.");
      }
    } else if (acc.isControl) {
      throw new VoucherProblem("Choose who the money is for.");
    }
    dr += l.debitPaisa;
    cr += l.creditPaisa;
  }
  if (dr === 0 && cr === 0) throw new VoucherProblem("Enter an amount.");
  if (type !== "opening" && dr !== cr) {
    throw new VoucherProblem("In and Out must add up to the same amount.");
  }

  const accs = used.map((l) => ({ l, a: accountById(l.accountId)! }));
  if (type === "payment") {
    if (!accs.some(({ l, a }) => l.creditPaisa > 0 && isCashOrBank(a))) {
      throw new VoucherProblem("Choose the cash or bank account the money was paid from.");
    }
  } else if (type === "receipt") {
    if (!accs.some(({ l, a }) => l.debitPaisa > 0 && isCashOrBank(a))) {
      throw new VoucherProblem("Choose the cash or bank account the money went into.");
    }
  } else if (type === "contra") {
    if (!accs.every(({ a }) => isCashOrBank(a))) {
      throw new VoucherProblem("A transfer moves money only between cash and bank accounts.");
    }
  } else if (type === "opening") {
    if (accs.some(({ a }) => a.kind === "income" || a.kind === "expense")) {
      throw new VoucherProblem("Starting balances are for what the clinic owns and owes, not income or expenses.");
    }
  }
  return Math.max(dr, cr);
}

/**
 * An opening voucher does not have to balance: whatever is left over is the
 * owner's, and lands on "Opening balances (to be moved)" for the accountant
 * to move to capital. Returns the line that balances it, or null.
 */
export function openingBalancingLine(lines: VoucherLineInput[]): VoucherLineInput | null {
  const dr = lines.reduce((s, l) => s + l.debitPaisa, 0);
  const cr = lines.reduce((s, l) => s + l.creditPaisa, 0);
  if (dr === cr) return null;
  return {
    accountId: "sys:opening",
    partyType: null,
    partyId: null,
    debitPaisa: dr < cr ? cr - dr : 0,
    creditPaisa: dr > cr ? dr - cr : 0,
    note: "Difference between what is owned and owed",
  };
}

// ---------------------------------------------------------------------------
// Aging
// ---------------------------------------------------------------------------

/** One movement in a party's account, signed so that + is "more is owed". */
export interface PartyMovement {
  dateAd: string;
  amountPaisa: number;
  ref: string;
}

export interface OpenItem {
  dateAd: string;
  ref: string;
  /** what the item came to */
  originalPaisa: number;
  /** what is still open on it */
  openPaisa: number;
}

/**
 * Settle a party's account oldest first: every payment clears the oldest bill
 * still open. What is left is the list of open bills, plus anything paid in
 * advance (a negative `advancePaisa`) when payments came to more than bills.
 */
export function openItemsOldestFirst(movements: PartyMovement[]): { items: OpenItem[]; advancePaisa: number } {
  const sorted = [...movements].sort((a, b) => (a.dateAd < b.dateAd ? -1 : a.dateAd > b.dateAd ? 1 : 0));
  const items: OpenItem[] = [];
  let credit = 0; // paid but not yet used against a bill
  for (const m of sorted) {
    if (m.amountPaisa > 0) {
      let open = m.amountPaisa;
      const take = Math.min(open, credit);
      open -= take;
      credit -= take;
      items.push({ dateAd: m.dateAd, ref: m.ref, originalPaisa: m.amountPaisa, openPaisa: open });
    } else if (m.amountPaisa < 0) {
      let pay = -m.amountPaisa;
      for (const it of items) {
        if (pay <= 0) break;
        const take = Math.min(pay, it.openPaisa);
        it.openPaisa -= take;
        pay -= take;
      }
      credit += pay;
    }
  }
  return { items: items.filter((i) => i.openPaisa > 0), advancePaisa: credit === 0 ? 0 : -credit };
}

export const AGING_BUCKETS = [
  { key: "d0", label: "0–30 days", min: 0, max: 30 },
  { key: "d31", label: "31–60 days", min: 31, max: 60 },
  { key: "d61", label: "61–90 days", min: 61, max: 90 },
  { key: "d91", label: "91–120 days", min: 91, max: 120 },
  { key: "d121", label: "Over 120 days", min: 121, max: Number.POSITIVE_INFINITY },
] as const;

export type AgingKey = (typeof AGING_BUCKETS)[number]["key"];

export type AgingTotals = Record<AgingKey, number>;

export function emptyAging(): AgingTotals {
  return { d0: 0, d31: 0, d61: 0, d91: 0, d121: 0 };
}

/** Whole days from a bill's date to `asOfAd`, never negative. */
export function daysBetween(fromAd: string, toAd: string): number {
  const ms = Date.parse(`${toAd}T00:00:00Z`) - Date.parse(`${fromAd}T00:00:00Z`);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 86_400_000));
}

export function bucketOf(days: number): AgingKey {
  for (const b of AGING_BUCKETS) if (days >= b.min && days <= b.max) return b.key;
  return "d121";
}

/** Spread open bills into the buckets, aged from the bill date (owner, 2083-08-03). */
export function ageItems(items: { dateAd: string; openPaisa: number }[], asOfAd: string): AgingTotals {
  const t = emptyAging();
  for (const it of items) {
    if (it.openPaisa <= 0) continue;
    t[bucketOf(daysBetween(it.dateAd, asOfAd))] += it.openPaisa;
  }
  return t;
}

/** Add `b` into `a`. */
export function addAging(a: AgingTotals, b: AgingTotals): AgingTotals {
  return { d0: a.d0 + b.d0, d31: a.d31 + b.d31, d61: a.d61 + b.d61, d91: a.d91 + b.d91, d121: a.d121 + b.d121 };
}

// ---------------------------------------------------------------------------
// Splitting a bill's discount between the parts of the clinic
// ---------------------------------------------------------------------------

/**
 * Share a discount across parts in proportion to their amounts, so the parts
 * add up to the discount exactly: each part's share is rounded down, and the
 * part at `remainderIndex` takes the leftover paisa. The ledger's SQL does
 * the same with the clinic's part taking the leftover (repos/ledger.ts).
 */
export function shareDiscount(discountPaisa: number, amounts: number[], remainderIndex: number): number[] {
  const total = amounts.reduce((s, a) => s + a, 0);
  if (total <= 0 || discountPaisa === 0) return amounts.map(() => 0);
  const shares = amounts.map((a, i) => (i === remainderIndex ? 0 : Math.trunc((discountPaisa * a) / total)));
  shares[remainderIndex] = discountPaisa - shares.reduce((s, x) => s + x, 0);
  return shares;
}
