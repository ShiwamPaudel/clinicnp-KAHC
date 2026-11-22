/**
 * accounts.ts — all SQL for the chart of accounts, other parties and the
 * vouchers entered by hand (0025). The books themselves are read in
 * ledger.ts.
 */
import "server-only";
import { ulid } from "ulid";
import { db } from "@/lib/db";
import type { Row } from "@/lib/db";
import { ClosedFiscalYearError } from "@/lib/repos/fiscal";
import {
  checkVoucher,
  controlAccountFor,
  openingBalancingLine,
  voucherNoLabel,
  VoucherProblem,
  isAccountGroup,
  ACCOUNT_GROUPS,
  type AccountFacts,
  type AccountKind,
  type AccountGroup,
  type PartyType,
  type VoucherLineInput,
  type VoucherType,
} from "@/lib/accounting";

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface Account {
  id: string;
  code: string;
  name: string;
  kind: AccountKind;
  grp: AccountGroup;
  segment: string | null;
  systemKey: string | null;
  isBank: boolean;
  isControl: boolean;
  autoOnly: boolean;
  note: string;
  active: boolean;
  sortOrder: number;
  /** used by a voucher or by the app's own posting: it can be switched off, never deleted */
  inUse: boolean;
}

function mapAccount(r: Row): Account {
  return {
    id: r.id as string,
    code: r.code as string,
    name: r.name as string,
    kind: r.kind as AccountKind,
    grp: r.grp as AccountGroup,
    segment: (r.segment as string | null) ?? null,
    systemKey: (r.system_key as string | null) ?? null,
    isBank: Number(r.is_bank) === 1,
    isControl: Number(r.is_control) === 1,
    autoOnly: Number(r.auto_only) === 1,
    note: (r.note as string | null) ?? "",
    active: Number(r.active) === 1,
    sortOrder: Number(r.sort_order ?? 100),
    inUse: r.system_key != null || Number(r.used ?? 0) > 0,
  };
}

const SELECT_ACCOUNT = `SELECT a.*,
  (SELECT COUNT(*) FROM voucher_lines vl WHERE vl.account_id = a.id)
  + (SELECT COUNT(*) FROM supplier_payments sp WHERE sp.account_id = a.id)
  + (SELECT COUNT(*) FROM lab_partner_payments lp WHERE lp.account_id = a.id) AS used
  FROM accounts a`;

export async function listAccounts(includeInactive = true): Promise<Account[]> {
  const res = await db().execute(
    `${SELECT_ACCOUNT} ${includeInactive ? "" : "WHERE a.active = 1"} ORDER BY a.code`,
  );
  return res.rows.map(mapAccount);
}

export async function getAccount(id: string): Promise<Account | null> {
  const res = await db().execute({ sql: `${SELECT_ACCOUNT} WHERE a.id = ?`, args: [id] });
  return res.rows[0] ? mapAccount(res.rows[0]) : null;
}

/** Cash, QR and every bank, for the "paid from" pickers. */
export async function listMoneyAccounts(): Promise<Account[]> {
  const res = await db().execute(
    `${SELECT_ACCOUNT} WHERE a.grp = 'cash_bank' AND a.active = 1 ORDER BY a.code`,
  );
  return res.rows.map(mapAccount);
}

/** Banks only (not cash, not QR), for the supplier and laboratory payment forms. */
export async function listBankAccounts(): Promise<{ id: string; name: string }[]> {
  const res = await db().execute(
    "SELECT id, name FROM accounts WHERE is_bank = 1 AND active = 1 AND id <> 'sys:bank_unassigned' ORDER BY code",
  );
  return res.rows.map((r) => ({ id: r.id as string, name: r.name as string }));
}

/** True when `id` is a bank a payment may name. */
export async function isUsableBank(id: string): Promise<boolean> {
  const res = await db().execute({
    sql: "SELECT 1 FROM accounts WHERE id = ? AND is_bank = 1 AND active = 1",
    args: [id],
  });
  return res.rows.length > 0;
}

export class AccountProblem extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.name = "AccountProblem";
    this.userMessage = userMessage;
  }
}

export interface AccountInput {
  id?: string;
  code: string;
  name: string;
  grp: string;
  /** a bank account: shown in "paid from" on supplier and laboratory payments */
  isBank: boolean;
  segment: string | null;
  note: string;
  active: boolean;
}

export async function saveAccount(input: AccountInput): Promise<string> {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code) throw new AccountProblem("Give the account a code.");
  if (!name) throw new AccountProblem("Give the account a name.");
  if (!isAccountGroup(input.grp)) throw new AccountProblem("Choose where the account belongs.");
  const segment = input.segment === "pharmacy" || input.segment === "clinic" || input.segment === "lab" ? input.segment : null;
  const now = new Date().toISOString();

  const clash = await db().execute({
    sql: "SELECT id, code, name FROM accounts WHERE (code = ? OR lower(name) = lower(?)) AND id <> ?",
    args: [code, name, input.id ?? ""],
  });
  if (clash.rows[0]) {
    throw new AccountProblem(
      (clash.rows[0].code as string) === code
        ? `Code ${code} is already used by ${clash.rows[0].name as string}.`
        : "There is already an account with that name.",
    );
  }

  if (input.id) {
    const existing = await getAccount(input.id);
    if (!existing) throw new AccountProblem("That account was not found.");
    if (existing.systemKey) {
      // The app posts to it by itself: only its label and note may change.
      if (!input.active) throw new AccountProblem("This account is used by the app itself and stays on.");
      await db().execute({
        sql: "UPDATE accounts SET code = ?, name = ?, note = ?, updated_at = ? WHERE id = ?",
        args: [code, name, input.note.trim(), now, input.id],
      });
      return input.id;
    }
    const grp = input.grp as AccountGroup;
    const kind = ACCOUNT_GROUPS[grp].kind;
    if (existing.inUse && kind !== existing.kind) {
      throw new AccountProblem("This account already has entries, so it cannot move to a different kind of heading.");
    }
    await db().execute({
      sql: `UPDATE accounts SET code = ?, name = ?, kind = ?, grp = ?, segment = ?, is_bank = ?, note = ?, active = ?, updated_at = ?
             WHERE id = ?`,
      args: [code, name, kind, grp, segment, grp === "cash_bank" && input.isBank ? 1 : 0, input.note.trim(), input.active ? 1 : 0, now, input.id],
    });
    return input.id;
  }

  const grp = input.grp as AccountGroup;
  const id = `acc:${ulid()}`;
  await db().execute({
    sql: `INSERT INTO accounts (id, code, name, kind, grp, segment, is_bank, note, active, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 100, ?, ?)`,
    args: [id, code, name, ACCOUNT_GROUPS[grp].kind, grp, segment, grp === "cash_bank" && input.isBank ? 1 : 0, input.note.trim(), input.active ? 1 : 0, now, now],
  });
  return id;
}

export async function deleteAccount(id: string): Promise<void> {
  const a = await getAccount(id);
  if (!a) return;
  if (a.inUse) throw new AccountProblem("This account has entries. Switch it off instead.");
  await db().execute({ sql: "DELETE FROM accounts WHERE id = ? AND system_key IS NULL", args: [id] });
}

// ---------------------------------------------------------------------------
// Other parties
// ---------------------------------------------------------------------------

export type PartySide = "debtor" | "creditor";

export const PARTY_CATEGORIES = ["insurance", "corporate", "staff", "landlord", "lender", "other"] as const;
export type PartyCategory = (typeof PARTY_CATEGORIES)[number];

export const PARTY_CATEGORY_LABEL: Record<PartyCategory, string> = {
  insurance: "Insurance",
  corporate: "Company / corporate client",
  staff: "Staff",
  landlord: "Landlord",
  lender: "Lender",
  other: "Other",
};

export interface Party {
  id: string;
  name: string;
  side: PartySide;
  category: PartyCategory;
  panNo: string;
  phone: string;
  address: string;
  note: string;
  active: boolean;
}

function mapParty(r: Row): Party {
  return {
    id: r.id as string,
    name: r.name as string,
    side: (r.side as string) === "debtor" ? "debtor" : "creditor",
    category: ((PARTY_CATEGORIES as readonly string[]).includes(r.category as string) ? r.category : "other") as PartyCategory,
    panNo: (r.pan_no as string) ?? "",
    phone: (r.phone as string) ?? "",
    address: (r.address as string) ?? "",
    note: (r.note as string) ?? "",
    active: Number(r.active) === 1,
  };
}

export async function listParties(includeInactive = true): Promise<Party[]> {
  const res = await db().execute(`SELECT * FROM parties ${includeInactive ? "" : "WHERE active = 1"} ORDER BY name`);
  return res.rows.map(mapParty);
}

export async function getParty(id: string): Promise<Party | null> {
  const res = await db().execute({ sql: "SELECT * FROM parties WHERE id = ?", args: [id] });
  return res.rows[0] ? mapParty(res.rows[0]) : null;
}

export interface PartyInput {
  id?: string;
  name: string;
  side: PartySide;
  category: string;
  panNo: string;
  phone: string;
  address: string;
  note: string;
  active: boolean;
}

export async function saveParty(input: PartyInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new AccountProblem("Enter the party's name.");
  const category = (PARTY_CATEGORIES as readonly string[]).includes(input.category) ? input.category : "other";
  const side = input.side === "debtor" ? "debtor" : "creditor";
  const now = new Date().toISOString();
  if (input.id) {
    const existing = await getParty(input.id);
    if (!existing) throw new AccountProblem("That party was not found.");
    if (existing.side !== side) {
      const used = await db().execute({
        sql: "SELECT 1 FROM voucher_lines WHERE party_type = 'party' AND party_id = ? LIMIT 1",
        args: [input.id],
      });
      if (used.rows.length > 0) {
        throw new AccountProblem("This party already has entries, so whether they owe or are owed cannot change.");
      }
    }
    await db().execute({
      sql: `UPDATE parties SET name = ?, side = ?, category = ?, pan_no = ?, phone = ?, address = ?, note = ?, active = ?, updated_at = ?
             WHERE id = ?`,
      args: [name, side, category, input.panNo.trim(), input.phone.trim(), input.address.trim(), input.note.trim(), input.active ? 1 : 0, now, input.id],
    });
    return input.id;
  }
  const id = ulid();
  await db().execute({
    sql: `INSERT INTO parties (id, name, side, category, pan_no, phone, address, note, active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, name, side, category, input.panNo.trim(), input.phone.trim(), input.address.trim(), input.note.trim(), input.active ? 1 : 0, now, now],
  });
  return id;
}

/** Everyone a voucher line may name, for the picker. */
export interface PartyChoice {
  partyType: PartyType;
  partyId: string;
  name: string;
  /** the control account their lines go to */
  accountId: string;
}

export async function listPartyChoices(): Promise<PartyChoice[]> {
  const res = await db().execute(`
    SELECT 'doctor' AS t, id, name, NULL AS side FROM doctors WHERE active = 1
    UNION ALL SELECT 'party', id, name, side FROM parties WHERE active = 1
    UNION ALL SELECT 'supplier', id, name, NULL FROM suppliers WHERE active = 1
    UNION ALL SELECT 'lab_partner', id, name, NULL FROM lab_partners WHERE active = 1
    ORDER BY 3`);
  return res.rows.map((r) => {
    const t = r.t as PartyType;
    return {
      partyType: t,
      partyId: r.id as string,
      name: r.name as string,
      accountId: controlAccountFor(t, (r.side as string | null) === "debtor" ? "debtor" : "creditor"),
    };
  });
}

/** The control account a party's lines must use, or undefined if the party is unknown. */
async function partyControlAccount(partyType: PartyType, partyId: string): Promise<string | undefined> {
  const table =
    partyType === "doctor" ? "doctors"
    : partyType === "party" ? "parties"
    : partyType === "supplier" ? "suppliers"
    : partyType === "lab_partner" ? "lab_partners"
    : null;
  if (!table) return undefined;
  const res = await db().execute({
    sql: `SELECT ${table === "parties" ? "side" : "NULL AS side"} FROM ${table} WHERE id = ?`, // sweep-ok: SQL
    args: [partyId],
  });
  if (!res.rows[0]) return undefined;
  return controlAccountFor(partyType, (res.rows[0].side as string | null) === "debtor" ? "debtor" : "creditor");
}

// ---------------------------------------------------------------------------
// Vouchers
// ---------------------------------------------------------------------------

export interface VoucherInput {
  type: VoucherType;
  dateAd: string;
  dateBs: string;
  narration: string;
  lines: VoucherLineInput[];
  userId: string;
  /** a delivery or other charge paid for this purchase bill (0030) */
  purchaseId?: string | null;
}

/** The open fiscal year a date falls in, or a ClosedFiscalYearError. */
async function openYearFor(dateAd: string): Promise<{ id: number; label: string }> {
  const res = await db().execute({
    sql: "SELECT id, bs_label, status FROM fiscal_years WHERE ? BETWEEN start_ad AND end_ad",
    args: [dateAd],
  });
  const fy = res.rows[0];
  if (!fy) throw new VoucherProblem("That date is outside every fiscal year the clinic has.");
  if ((fy.status as string) !== "open") throw new ClosedFiscalYearError();
  return { id: Number(fy.id), label: fy.bs_label as string };
}

export async function createVoucher(input: VoucherInput): Promise<{ id: string; voucherNo: string }> {
  const fy = await openYearFor(input.dateAd);
  const accounts = new Map((await listAccounts()).map((a) => [a.id, a]));
  const facts = (id: string): AccountFacts | undefined => {
    const a = accounts.get(id);
    return a && { id: a.id, kind: a.kind, grp: a.grp, active: a.active, isControl: a.isControl, autoOnly: a.autoOnly };
  };
  const partyAccounts = new Map<string, string | undefined>();
  for (const l of input.lines) {
    if (l.partyType && l.partyId) {
      partyAccounts.set(`${l.partyType}:${l.partyId}`, await partyControlAccount(l.partyType, l.partyId));
    }
  }
  const lines = input.lines
    .filter((l) => l.debitPaisa !== 0 || l.creditPaisa !== 0)
    .map((l) => ({
      ...l,
      partyType: l.partyType || null,
      partyId: l.partyId || null,
      // a party's line always goes to that party's control account
      accountId: l.partyType && l.partyId ? (partyAccounts.get(`${l.partyType}:${l.partyId}`) ?? l.accountId) : l.accountId,
    }));
  const total = checkVoucher(input.type, lines, facts, (t, id) => partyAccounts.get(`${t}:${id}`));
  if (input.type === "opening") {
    const balancing = openingBalancingLine(lines);
    if (balancing) lines.push(balancing);
  }

  const id = ulid();
  const now = new Date().toISOString();
  const counter = `voucher:${input.type}:${fy.id}`;
  const tx = await db().transaction("write");
  try {
    await tx.execute({ sql: "INSERT OR IGNORE INTO counters (name, next_value) VALUES (?, 1)", args: [counter] });
    const seq = await tx.execute({
      sql: "UPDATE counters SET next_value = next_value + 1 WHERE name = ? RETURNING next_value",
      args: [counter],
    });
    const no = Number(seq.rows[0]!.next_value) - 1;
    await tx.execute({
      sql: `INSERT INTO vouchers (id, voucher_type, voucher_no, fiscal_year_id, date_ad, date_bs, narration, total_paisa, status, user_id, created_at, purchase_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?)`,
      args: [id, input.type, no, fy.id, input.dateAd, input.dateBs, input.narration.trim(), total, input.userId, now, input.purchaseId ?? null],
    });
    let n = 0;
    for (const l of lines) {
      await tx.execute({
        sql: `INSERT INTO voucher_lines (id, voucher_id, line_no, account_id, party_type, party_id, debit_paisa, credit_paisa,
                                         ref_no, ref_date_ad, ref_date_bs, note)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          ulid(), id, ++n, l.accountId, l.partyType, l.partyId, l.debitPaisa, l.creditPaisa,
          (l.refNo ?? "").trim(), l.refDateAd ?? null, l.refDateBs ?? null, (l.note ?? "").trim(),
        ],
      });
    }
    await tx.execute({
      sql: "INSERT INTO audit_log (id, user_id, action, detail_json, at) VALUES (?, ?, 'voucher_posted', ?, ?)",
      args: [ulid(), input.userId, JSON.stringify({ voucherId: id, type: input.type, totalPaisa: total }), now],
    });
    await tx.commit();
    return { id, voucherNo: voucherNoLabel(input.type, fy.label, no) };
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

/**
 * Cancel a voucher: it is reversed on `dateAd` (normally today) and kept,
 * marked cancelled. A voucher is never edited or deleted.
 */
export async function cancelVoucher(input: {
  id: string;
  dateAd: string;
  dateBs: string;
  reason: string;
  userId: string;
}): Promise<void> {
  const v = await db().execute({ sql: "SELECT status, date_ad FROM vouchers WHERE id = ?", args: [input.id] });
  const row = v.rows[0];
  if (!row) throw new VoucherProblem("That voucher was not found.");
  if ((row.status as string) === "cancelled") return;
  if (!input.reason.trim()) throw new VoucherProblem("Say why it is being cancelled.");
  if (input.dateAd < (row.date_ad as string)) throw new VoucherProblem("It cannot be cancelled before the day it was made.");
  await openYearFor(input.dateAd);
  const now = new Date().toISOString();
  await db().batch(
    [
      {
        sql: `UPDATE vouchers SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?,
                     cancel_date_ad = ?, cancel_date_bs = ?
               WHERE id = ? AND status = 'posted'`,
        args: [now, input.userId, input.reason.trim(), input.dateAd, input.dateBs, input.id],
      },
      {
        sql: "INSERT INTO audit_log (id, user_id, action, detail_json, at) VALUES (?, ?, 'voucher_cancelled', ?, ?)",
        args: [ulid(), input.userId, JSON.stringify({ voucherId: input.id }), now],
      },
    ],
    "write",
  );
}

export interface VoucherLineView {
  accountId: string;
  accountName: string;
  accountCode: string;
  partyType: PartyType | null;
  partyId: string | null;
  partyName: string;
  debitPaisa: number;
  creditPaisa: number;
  refNo: string;
  refDateBs: string | null;
  note: string;
}

export interface VoucherView {
  id: string;
  type: VoucherType;
  voucherNo: string;
  fiscalLabel: string;
  fiscalStatus: string;
  dateAd: string;
  dateBs: string;
  narration: string;
  totalPaisa: number;
  status: "posted" | "cancelled";
  cancelReason: string;
  cancelDateBs: string | null;
  userName: string;
  cancelledByName: string;
  createdAt: string;
  lines: VoucherLineView[];
}

const PARTY_JOINS = `
  LEFT JOIN suppliers su ON vl.party_type = 'supplier' AND su.id = vl.party_id
  LEFT JOIN lab_partners lp ON vl.party_type = 'lab_partner' AND lp.id = vl.party_id
  LEFT JOIN doctors dr ON vl.party_type = 'doctor' AND dr.id = vl.party_id
  LEFT JOIN parties pa ON vl.party_type = 'party' AND pa.id = vl.party_id`;

export async function getVoucher(id: string): Promise<VoucherView | null> {
  const res = await db().execute({
    sql: `SELECT v.*, f.bs_label, f.status AS fy_status, u.name AS user_name, c.name AS cancelled_by_name
            FROM vouchers v
            JOIN fiscal_years f ON f.id = v.fiscal_year_id
            LEFT JOIN users u ON u.id = v.user_id
            LEFT JOIN users c ON c.id = v.cancelled_by
           WHERE v.id = ?`,
    args: [id],
  });
  const v = res.rows[0];
  if (!v) return null;
  const lines = await db().execute({
    sql: `SELECT vl.*, a.name AS account_name, a.code AS account_code,
                 COALESCE(su.name, lp.name, dr.name, pa.name, '') AS party_name
            FROM voucher_lines vl
            JOIN accounts a ON a.id = vl.account_id
            ${PARTY_JOINS}
           WHERE vl.voucher_id = ?
           ORDER BY vl.line_no`,
    args: [id],
  });
  const type = v.voucher_type as VoucherType;
  return {
    id,
    type,
    voucherNo: voucherNoLabel(type, v.bs_label as string, Number(v.voucher_no)),
    fiscalLabel: v.bs_label as string,
    fiscalStatus: v.fy_status as string,
    dateAd: v.date_ad as string,
    dateBs: v.date_bs as string,
    narration: (v.narration as string) ?? "",
    totalPaisa: Number(v.total_paisa),
    status: (v.status as string) === "cancelled" ? "cancelled" : "posted",
    cancelReason: (v.cancel_reason as string) ?? "",
    cancelDateBs: (v.cancel_date_bs as string | null) ?? null,
    userName: (v.user_name as string | null) ?? "",
    cancelledByName: (v.cancelled_by_name as string | null) ?? "",
    createdAt: v.created_at as string,
    lines: lines.rows.map((l) => ({
      accountId: l.account_id as string,
      accountName: l.account_name as string,
      accountCode: l.account_code as string,
      partyType: (l.party_type as PartyType | null) ?? null,
      partyId: (l.party_id as string | null) ?? null,
      partyName: (l.party_name as string) ?? "",
      debitPaisa: Number(l.debit_paisa),
      creditPaisa: Number(l.credit_paisa),
      refNo: (l.ref_no as string) ?? "",
      refDateBs: (l.ref_date_bs as string | null) ?? null,
      note: (l.note as string) ?? "",
    })),
  };
}

export interface VoucherListRow {
  id: string;
  type: VoucherType;
  voucherNo: string;
  dateAd: string;
  dateBs: string;
  narration: string;
  totalPaisa: number;
  status: "posted" | "cancelled";
  /** the accounts and parties on it, for a one-line summary */
  summary: string;
}

export async function listVouchers(fromIso: string, toIso: string, type: VoucherType | null): Promise<VoucherListRow[]> {
  const res = await db().execute({
    sql: `SELECT v.id, v.voucher_type, v.voucher_no, v.date_ad, v.date_bs, v.narration, v.total_paisa, v.status, f.bs_label,
                 (SELECT GROUP_CONCAT(x, ', ') FROM (
                    SELECT DISTINCT COALESCE(su.name, lp.name, dr.name, pa.name, a.name) AS x
                      FROM voucher_lines vl JOIN accounts a ON a.id = vl.account_id
                      ${PARTY_JOINS}
                     WHERE vl.voucher_id = v.id)) AS summary
            FROM vouchers v JOIN fiscal_years f ON f.id = v.fiscal_year_id
           WHERE v.date_ad BETWEEN ? AND ? ${type ? "AND v.voucher_type = ?" : ""}
           ORDER BY v.date_ad DESC, v.created_at DESC`,
    args: type ? [fromIso, toIso, type] : [fromIso, toIso],
  });
  return res.rows.map((r) => {
    const t = r.voucher_type as VoucherType;
    return {
      id: r.id as string,
      type: t,
      voucherNo: voucherNoLabel(t, r.bs_label as string, Number(r.voucher_no)),
      dateAd: r.date_ad as string,
      dateBs: r.date_bs as string,
      narration: (r.narration as string) ?? "",
      totalPaisa: Number(r.total_paisa),
      status: (r.status as string) === "cancelled" ? "cancelled" : "posted",
      summary: (r.summary as string | null) ?? "",
    };
  });
}
