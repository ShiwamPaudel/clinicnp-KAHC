/**
 * ledger-reports.ts — the statements built on ledger.ts: trial balance,
 * profit and loss by part of the clinic, balance sheet, party balances and
 * aging, and the checks that the books agree with the screens they shadow.
 *
 * Income and expense accounts start again at zero each fiscal year; what they
 * came to in earlier years shows as "profit of earlier years" under capital.
 * Nothing is closed or carried by hand.
 */
import "server-only";
import { db } from "@/lib/db";
import { adFromIso, adToIso, fiscalYearAdRange, fiscalYearOf, toBS } from "@/lib/bs";
import {
  accountSegmentTotals,
  accountTotals,
  DAWN,
  dayBefore,
  partyBalances,
  partyMovements,
  profitBetween,
} from "@/lib/repos/ledger";
import { listAccounts, listParties, type Account } from "@/lib/repos/accounts";
import { duesTotals, listDuePeople } from "@/lib/repos/dues";
import { listSuppliers, supplierBalance } from "@/lib/repos/suppliers";
import { partnerSummary } from "@/lib/repos/clinic-reports";
import { resolveRange } from "@/lib/date-range";
import {
  addAging,
  ageItems,
  emptyAging,
  naturalBalance,
  openItemsOldestFirst,
  type AgingTotals,
  type PartyType,
} from "@/lib/accounting";

/** The first day of the fiscal year an AD date falls in. */
export function fiscalYearStartOf(iso: string): string {
  return adToIso(fiscalYearAdRange(fiscalYearOf(toBS(adFromIso(iso)))).startAd);
}

const isPandL = (a: Account) => a.kind === "income" || a.kind === "expense";

// ---------------------------------------------------------------------------
// Trial balance
// ---------------------------------------------------------------------------

export interface TrialBalanceRow {
  account: Account;
  /** debit minus credit */
  openingPaisa: number;
  drPaisa: number;
  crPaisa: number;
  closingPaisa: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  /** profit of the fiscal years before this one, as a credit (+) */
  earlierProfitPaisa: number;
  totals: { openingDr: number; openingCr: number; dr: number; cr: number; closingDr: number; closingCr: number };
}

export async function trialBalance(fromIso: string, toIso: string): Promise<TrialBalance> {
  const fyStart = fiscalYearStartOf(fromIso);
  const [accounts, before, beforeInYear, moved, earlier] = await Promise.all([
    listAccounts(),
    accountTotals(DAWN, dayBefore(fromIso)),
    accountTotals(fyStart, dayBefore(fromIso)),
    accountTotals(fromIso, toIso),
    profitBetween(DAWN, dayBefore(fyStart)),
  ]);
  const rows: TrialBalanceRow[] = [];
  for (const a of accounts) {
    const o = (isPandL(a) ? beforeInYear : before).get(a.id);
    const m = moved.get(a.id);
    const opening = o ? o.drPaisa - o.crPaisa : 0;
    const dr = m?.drPaisa ?? 0;
    const cr = m?.crPaisa ?? 0;
    if (opening === 0 && dr === 0 && cr === 0) continue;
    rows.push({ account: a, openingPaisa: opening, drPaisa: dr, crPaisa: cr, closingPaisa: opening + dr - cr });
  }
  const totals = { openingDr: 0, openingCr: 0, dr: 0, cr: 0, closingDr: 0, closingCr: 0 };
  for (const r of rows) {
    if (r.openingPaisa > 0) totals.openingDr += r.openingPaisa;
    else totals.openingCr -= r.openingPaisa;
    totals.dr += r.drPaisa;
    totals.cr += r.crPaisa;
    if (r.closingPaisa > 0) totals.closingDr += r.closingPaisa;
    else totals.closingCr -= r.closingPaisa;
  }
  if (earlier > 0) {
    totals.openingCr += earlier;
    totals.closingCr += earlier;
  } else {
    totals.openingDr -= earlier;
    totals.closingDr -= earlier;
  }
  return { rows, earlierProfitPaisa: earlier, totals };
}

// ---------------------------------------------------------------------------
// Profit and loss
// ---------------------------------------------------------------------------

export type SegmentKey = "pharmacy" | "clinic" | "lab" | "common";
export const SEGMENT_KEYS: SegmentKey[] = ["pharmacy", "clinic", "lab", "common"];

export interface PnlRow {
  account: Account;
  /** natural amount: income as a credit, expenses as a debit; + is normal */
  bySegment: Record<SegmentKey, number>;
  totalPaisa: number;
}

export interface ProfitAndLoss {
  directIncome: PnlRow[];
  directExpense: PnlRow[];
  indirectIncome: PnlRow[];
  indirectExpense: PnlRow[];
  grossProfit: Record<SegmentKey, number> & { total: number };
  netProfit: Record<SegmentKey, number> & { total: number };
}

function zeroSegments(): Record<SegmentKey, number> {
  return { pharmacy: 0, clinic: 0, lab: 0, common: 0 };
}

export async function profitAndLoss(fromIso: string, toIso: string): Promise<ProfitAndLoss> {
  const [accounts, totals] = await Promise.all([listAccounts(), accountSegmentTotals(fromIso, toIso)]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const rows = new Map<string, PnlRow>();
  for (const t of totals) {
    const a = byId.get(t.accountId);
    if (!a || !isPandL(a)) continue;
    let r = rows.get(a.id);
    if (!r) {
      r = { account: a, bySegment: zeroSegments(), totalPaisa: 0 };
      rows.set(a.id, r);
    }
    const seg: SegmentKey = t.segment === "pharmacy" || t.segment === "clinic" || t.segment === "lab" ? t.segment : "common";
    const amount = naturalBalance(a.kind, t.drPaisa, t.crPaisa);
    r.bySegment[seg] += amount;
    r.totalPaisa += amount;
  }
  const list = [...rows.values()].filter((r) => r.totalPaisa !== 0 || SEGMENT_KEYS.some((k) => r.bySegment[k] !== 0));
  list.sort((x, y) => x.account.code.localeCompare(y.account.code));
  const pick = (grp: string) => list.filter((r) => r.account.grp === grp);
  const directIncome = pick("direct_income");
  const directExpense = pick("direct_expense");
  const indirectIncome = pick("indirect_income");
  const indirectExpense = pick("indirect_expense");
  const sum = (rs: PnlRow[], k: SegmentKey) => rs.reduce((s, r) => s + r.bySegment[k], 0);
  const gp = zeroSegments();
  const np = zeroSegments();
  for (const k of SEGMENT_KEYS) {
    gp[k] = sum(directIncome, k) - sum(directExpense, k);
    np[k] = gp[k] + sum(indirectIncome, k) - sum(indirectExpense, k);
  }
  const total = (o: Record<SegmentKey, number>) => SEGMENT_KEYS.reduce((s, k) => s + o[k], 0);
  return {
    directIncome,
    directExpense,
    indirectIncome,
    indirectExpense,
    grossProfit: { ...gp, total: total(gp) },
    netProfit: { ...np, total: total(np) },
  };
}

// ---------------------------------------------------------------------------
// Balance sheet
// ---------------------------------------------------------------------------

export interface BalanceSheetLine {
  account: Account;
  /** natural balance: assets as debits, the rest as credits; + is normal */
  amountPaisa: number;
}

export interface BalanceSheet {
  asOfIso: string;
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  equity: BalanceSheetLine[];
  profitThisYearPaisa: number;
  profitEarlierPaisa: number;
  totalAssetsPaisa: number;
  totalLiabilitiesAndCapitalPaisa: number;
}

export async function balanceSheet(asOfIso: string): Promise<BalanceSheet> {
  const fyStart = fiscalYearStartOf(asOfIso);
  const [accounts, totals, thisYear, earlier] = await Promise.all([
    listAccounts(),
    accountTotals(DAWN, asOfIso),
    profitBetween(fyStart, asOfIso),
    profitBetween(DAWN, dayBefore(fyStart)),
  ]);
  const lines = (kind: Account["kind"]) =>
    accounts
      .filter((a) => a.kind === kind)
      .map((a) => {
        const t = totals.get(a.id);
        return { account: a, amountPaisa: t ? naturalBalance(a.kind, t.drPaisa, t.crPaisa) : 0 };
      })
      .filter((l) => l.amountPaisa !== 0);
  const assets = lines("asset");
  const liabilities = lines("liability");
  const equity = lines("equity");
  const s = (ls: BalanceSheetLine[]) => ls.reduce((x, l) => x + l.amountPaisa, 0);
  return {
    asOfIso,
    assets,
    liabilities,
    equity,
    profitThisYearPaisa: thisYear,
    profitEarlierPaisa: earlier,
    totalAssetsPaisa: s(assets),
    totalLiabilitiesAndCapitalPaisa: s(liabilities) + s(equity) + thisYear + earlier,
  };
}

// ---------------------------------------------------------------------------
// Account balances for the overview
// ---------------------------------------------------------------------------

export async function balancesOn(asOfIso: string): Promise<{ account: Account; balancePaisa: number }[]> {
  const [accounts, totals] = await Promise.all([listAccounts(), accountTotals(DAWN, asOfIso)]);
  return accounts.map((a) => {
    const t = totals.get(a.id);
    return { account: a, balancePaisa: t ? naturalBalance(a.kind, t.drPaisa, t.crPaisa) : 0 };
  });
}

// ---------------------------------------------------------------------------
// Parties and aging
// ---------------------------------------------------------------------------

export interface AgingRow {
  partyType: PartyType;
  partyId: string;
  name: string;
  /** what is open, oldest first, and how old */
  openPaisa: number;
  buckets: AgingTotals;
  /** paid ahead or overpaid: a figure on the other side */
  advancePaisa: number;
  oldestDateAd: string | null;
}

export interface AgingReport {
  side: "receivable" | "payable";
  rows: AgingRow[];
  totals: AgingTotals;
  totalOpenPaisa: number;
}

/**
 * Who owes the clinic (receivable) or whom the clinic owes (payable), with
 * what is owed split by age from the bill date (owner, 2083-08-03).
 *
 * Patients' dues come bill by bill from the Dues list (lib/dues.ts), so they
 * age exactly as that screen shows. Everyone else is settled oldest first.
 */
export async function agingReport(side: "receivable" | "payable", asOfIso: string): Promise<AgingReport> {
  const rows: AgingRow[] = [];
  const parties = await listParties();
  const debtors = new Set(parties.filter((p) => p.side === "debtor").map((p) => p.id));

  if (side === "receivable") {
    for (const p of await listDuePeople(asOfIso)) {
      const buckets = ageItems(
        p.bills.map((b) => ({ dateAd: b.dateAd, openPaisa: b.balancePaisa })),
        asOfIso,
      );
      rows.push({
        partyType: p.patientId ? "patient" : "walkin",
        partyId: p.patientId ?? p.name,
        name: p.name,
        openPaisa: p.owedPaisa,
        buckets,
        advancePaisa: 0,
        oldestDateAd: p.oldestDateAd || null,
      });
    }
  }

  const types: PartyType[] = side === "receivable" ? ["party"] : ["supplier", "lab_partner", "doctor", "party"];
  const moves = await partyMovements(side, types, asOfIso);
  for (const m of moves.values()) {
    if (m.partyType === "party" && debtors.has(m.partyId) !== (side === "receivable")) continue;
    const { items, advancePaisa } = openItemsOldestFirst(m.moves);
    const open = items.reduce((s, i) => s + i.openPaisa, 0);
    if (open === 0 && advancePaisa === 0) continue;
    rows.push({
      partyType: m.partyType,
      partyId: m.partyId,
      name: m.name,
      openPaisa: open,
      buckets: ageItems(items, asOfIso),
      advancePaisa,
      oldestDateAd: items[0]?.dateAd ?? null,
    });
  }
  rows.sort((a, b) => b.openPaisa - a.openPaisa || a.name.localeCompare(b.name));
  return {
    side,
    rows,
    totals: rows.reduce((t, r) => addAging(t, r.buckets), emptyAging()),
    totalOpenPaisa: rows.reduce((s, r) => s + r.openPaisa, 0),
  };
}

export interface PartyListRow {
  partyType: PartyType;
  partyId: string;
  name: string;
  /** + owes the clinic, − the clinic owes them */
  balancePaisa: number;
}

/** Every party with a balance, today. */
export async function partyList(asOfIso: string): Promise<PartyListRow[]> {
  const rows = await partyBalances(asOfIso);
  return rows
    .filter((r) => r.balancePaisa !== 0)
    .map((r) => ({ partyType: r.partyType, partyId: r.partyId, name: r.name, balancePaisa: r.balancePaisa }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export interface BookCheck {
  key: string;
  label: string;
  ok: boolean;
  /** what the books say */
  booksPaisa: number | null;
  /** what the screen it shadows says */
  screenPaisa: number | null;
  /** what to do when it is off */
  help: string;
  /** information rather than a fault */
  info?: boolean;
}

export async function bookChecks(): Promise<BookCheck[]> {
  const totals = await accountTotals(DAWN, "9999-12-31");
  const bal = (id: string) => {
    const t = totals.get(id);
    return t ? t.drPaisa - t.crPaisa : 0;
  };
  let dr = 0;
  let cr = 0;
  for (const t of totals.values()) {
    dr += t.drPaisa;
    cr += t.crPaisa;
  }
  const checks: BookCheck[] = [
    {
      key: "balanced",
      label: "Debits equal credits",
      ok: dr === cr,
      booksPaisa: dr,
      screenPaisa: cr,
      help: "Every entry has two equal sides. If this is ever off, tell the people who look after the app.",
    },
  ];

  const dues = await duesTotals();
  checks.push({
    key: "dues",
    label: "Patients' dues match the Dues list",
    ok: bal("sys:recv_patients") === dues.owedPaisa,
    booksPaisa: bal("sys:recv_patients"),
    screenPaisa: dues.owedPaisa,
    help: "A difference means money was taken against a bill that was later cancelled. Open Patients' dues under Parties to see who.",
  });

  const suppliers = await listSuppliers(true);
  let supplierTotal = 0;
  for (const s of suppliers) supplierTotal += await supplierBalance(s.id);
  checks.push({
    key: "suppliers",
    label: "Suppliers match their pages",
    ok: -bal("sys:pay_suppliers") === supplierTotal,
    booksPaisa: -bal("sys:pay_suppliers"),
    screenPaisa: supplierTotal,
    help: "Each supplier's page and the books read the same purchases, returns and payments.",
  });

  const labs = await partnerSummary(resolveRange({}));
  const labTotal = labs.reduce((s, l) => s + l.balancePaisa, 0);
  checks.push({
    key: "labs",
    label: "Outside laboratories match Payables",
    ok: -bal("sys:pay_labs") === labTotal,
    booksPaisa: -bal("sys:pay_labs"),
    screenPaisa: labTotal,
    help: "A small difference can come from a refunded test: the books take it off on the day of the refund.",
  });

  const shelf = Number(
    (await db().execute("SELECT IFNULL(SUM(remaining_base_qty * purchase_cost_paisa_per_base), 0) AS v FROM batches")).rows[0]!.v,
  );
  checks.push({
    key: "stock",
    label: "Medicine stock matches the shelf at cost",
    ok: bal("sys:stock") === shelf,
    booksPaisa: bal("sys:stock"),
    screenPaisa: shelf,
    help: "A few rupees apart is normal: a pack's cost is spread over its tablets and rounded to the paisa.",
    info: Math.abs(bal("sys:stock") - shelf) <= 10_000,
  });

  const unassigned = bal("sys:bank_unassigned");
  checks.push({
    key: "bank_unassigned",
    label: "Every bank payment says which bank",
    ok: unassigned === 0,
    booksPaisa: unassigned,
    screenPaisa: null,
    help: "Some supplier or laboratory payments were made by bank or cheque without choosing the bank. Move the amount with a cash and bank transfer.",
  });

  const opening = bal("sys:opening");
  checks.push({
    key: "opening",
    label: "Opening balances have been moved",
    ok: opening === 0,
    booksPaisa: -opening,
    screenPaisa: null,
    info: true,
    help: "Opening stock and opening balances land here. Once the accountant agrees the figure, move it to Capital with a journal.",
  });

  const qr = bal("sys:qr");
  checks.push({
    key: "qr",
    label: "QR / wallet money moved to the bank",
    ok: qr === 0,
    booksPaisa: qr,
    screenPaisa: null,
    info: true,
    help: "QR payments wait here until the wallet pays them into the bank. Record that with a cash and bank transfer.",
  });

  return checks;
}
