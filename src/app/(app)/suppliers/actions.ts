"use server";

import { revalidatePath } from "next/cache";
import { assertPermission, NotAuthorizedError } from "@/lib/session";
import { requireModule, ModuleDisabledError } from "@/lib/modules";
import {
  createSupplier,
  updateSupplier,
  recordSupplierPayment,
  purchaseBelongsTo,
} from "@/lib/repos/suppliers";
import { supplierSchema, supplierPaymentSchema } from "@/lib/validators";
import { adToIso, toAD, bsFromDbText } from "@/lib/bs";
import { isUsableBank } from "@/lib/repos/accounts";

export interface ActionResult {
  ok: boolean;
  userMessage?: string;
  id?: string;
}

function fail(userMessage: string): ActionResult {
  return { ok: false, userMessage };
}

function handle(err: unknown): ActionResult {
  if (err instanceof ModuleDisabledError) return fail(err.userMessage);
  if (err instanceof NotAuthorizedError) return fail(err.userMessage);
  console.error("[suppliers action]", err);
  return fail("Something went wrong. Please try again.");
}

export async function saveSupplierAction(input: unknown): Promise<ActionResult> {
  try {
    await requireModule("pharmacy");
    await assertPermission("suppliers.manage");
    const parsed = supplierSchema.safeParse(input);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    }
    const { id, ...data } = parsed.data;
    if (id) {
      await updateSupplier(id, data);
      revalidatePath(`/suppliers/${id}`);
      revalidatePath("/suppliers");
      return { ok: true, id };
    }
    const newId = await createSupplier(data);
    revalidatePath("/suppliers");
    return { ok: true, id: newId };
  } catch (err) {
    return handle(err);
  }
}

export async function recordPaymentAction(input: unknown): Promise<ActionResult> {
  try {
    await requireModule("pharmacy");
    const user = await assertPermission("suppliers.manage");
    const parsed = supplierPaymentSchema.safeParse(input);
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? "Please check the details.");
    }
    const d = parsed.data;
    // Only a bank or cheque payment names a bank, and only a bank that is on.
    const bankPaid = d.method === "bank" || d.method === "cheque";
    const accountId = bankPaid && d.accountId ? d.accountId : null;
    if (accountId && !(await isUsableBank(accountId))) return fail("Choose the bank again.");
    // A transfer charge is the bank's or wallet's fee: cash has none.
    const sentElectronically = bankPaid || d.method === "qr";
    if (d.transferChargePaisa > 0 && !sentElectronically) {
      return fail("A transfer charge is only for a QR or bank payment.");
    }
    if (d.purchaseId && !(await purchaseBelongsTo(d.purchaseId, d.supplierId))) {
      return fail("That purchase bill is not from this supplier. Choose it again.");
    }
    await recordSupplierPayment({
      transferChargePaisa: sentElectronically ? d.transferChargePaisa : 0,
      purchaseId: d.purchaseId || null,
      accountId,
      supplierId: d.supplierId,
      dateBs: d.dateBs,
      dateAd: adToIso(toAD(bsFromDbText(d.dateBs))),
      amountPaisa: d.amountPaisa,
      method: d.method,
      note: d.note,
      userId: user.id,
    });
    revalidatePath(`/suppliers/${d.supplierId}`);
    return { ok: true };
  } catch (err) {
    return handle(err);
  }
}
