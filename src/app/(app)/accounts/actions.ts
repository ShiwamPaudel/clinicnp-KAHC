"use server";

/**
 * Accounts actions (prod-docs/Accounting.md). Each one: permission, then the
 * repo. Errors come back as plain sentences; nothing a library said is shown.
 */
import { revalidatePath } from "next/cache";
import { assertPermission, NotAuthorizedError } from "@/lib/session";
import { recordAudit } from "@/lib/repos/audit";
import {
  AccountProblem,
  cancelVoucher,
  createVoucher,
  deleteAccount,
  saveAccount,
  saveParty,
} from "@/lib/repos/accounts";
import { ClosedFiscalYearError } from "@/lib/repos/fiscal";
import { VoucherProblem } from "@/lib/accounting";
import { accountSchema, cancelVoucherSchema, partySchema, voucherSchema } from "@/lib/validators";
import { adToIso, bsFromDbText, bsToDbText, toAD, today } from "@/lib/bs";

export interface AccountsActionResult {
  ok: boolean;
  userMessage?: string;
  id?: string;
  voucherNo?: string;
}

function fail(userMessage: string): AccountsActionResult {
  return { ok: false, userMessage };
}

function handle(err: unknown): AccountsActionResult {
  if (err instanceof NotAuthorizedError) return fail(err.userMessage);
  if (err instanceof VoucherProblem) return fail(err.userMessage);
  if (err instanceof AccountProblem) return fail(err.userMessage);
  if (err instanceof ClosedFiscalYearError) return fail(err.userMessage);
  console.error("[accounts action]", err);
  return fail("Something went wrong. Please try again.");
}

const toIso = (bs: string) => adToIso(toAD(bsFromDbText(bs)));

export async function saveAccountAction(input: unknown): Promise<AccountsActionResult> {
  try {
    const user = await assertPermission("accounts.setup");
    const parsed = accountSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const id = await saveAccount(parsed.data);
    await recordAudit(user.id, parsed.data.id ? "account.updated" : "account.created", {
      entity: "account",
      entityId: id,
      detail: `${parsed.data.code} ${parsed.data.name}`,
    });
    revalidatePath("/accounts", "layout");
    return { ok: true, id };
  } catch (err) {
    return handle(err);
  }
}

export async function deleteAccountAction(id: string): Promise<AccountsActionResult> {
  try {
    const user = await assertPermission("accounts.setup");
    await deleteAccount(id);
    await recordAudit(user.id, "account.deleted", { entity: "account", entityId: id });
    revalidatePath("/accounts", "layout");
    return { ok: true };
  } catch (err) {
    return handle(err);
  }
}

export async function savePartyAction(input: unknown): Promise<AccountsActionResult> {
  try {
    const user = await assertPermission("accounts.setup");
    const parsed = partySchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const id = await saveParty(parsed.data);
    await recordAudit(user.id, parsed.data.id ? "party.updated" : "party.created", {
      entity: "party",
      entityId: id,
      detail: parsed.data.name,
    });
    revalidatePath("/accounts", "layout");
    return { ok: true, id };
  } catch (err) {
    return handle(err);
  }
}

export async function createVoucherAction(input: unknown): Promise<AccountsActionResult> {
  try {
    const parsed = voucherSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const d = parsed.data;
    // Opening balances set the starting point of the books: set-up, not posting.
    const user = await assertPermission(d.type === "opening" ? "accounts.setup" : "accounts.post");
    const res = await createVoucher({
      type: d.type,
      dateBs: d.dateBs,
      dateAd: toIso(d.dateBs),
      narration: d.narration,
      lines: d.lines.map((l) => ({
        accountId: l.accountId,
        partyType: l.partyType,
        partyId: l.partyId,
        debitPaisa: l.debitPaisa,
        creditPaisa: l.creditPaisa,
        refNo: l.refNo ?? "",
        refDateBs: l.refDateBs ?? null,
        refDateAd: l.refDateBs ? toIso(l.refDateBs) : null,
        note: l.note ?? "",
      })),
      userId: user.id,
    });
    revalidatePath("/accounts", "layout");
    return { ok: true, id: res.id, voucherNo: res.voucherNo };
  } catch (err) {
    return handle(err);
  }
}

export async function cancelVoucherAction(input: unknown): Promise<AccountsActionResult> {
  try {
    const user = await assertPermission("accounts.post");
    const parsed = cancelVoucherSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    const dateBs = bsToDbText(today());
    await cancelVoucher({ id: parsed.data.id, dateBs, dateAd: toIso(dateBs), reason: parsed.data.reason, userId: user.id });
    revalidatePath("/accounts", "layout");
    return { ok: true };
  } catch (err) {
    return handle(err);
  }
}
