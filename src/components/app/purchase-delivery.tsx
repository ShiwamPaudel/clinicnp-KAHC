"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DatePickerBS } from "@/components/ui/date-picker-bs";
import { useToast } from "@/components/ui/toast";
import { recordDeliveryAction } from "@/app/(app)/purchases/actions";
import { formatPaisa, toPaisa } from "@/lib/money";
import { bsToDbText, today } from "@/lib/bs";
import { strings } from "@/lib/strings";

/**
 * A purchase bill's delivery: what was paid to the courier for it, and a way
 * to record that. Not owed to the supplier; each one is a payment voucher.
 */
export function PurchaseDelivery({
  purchaseId,
  purchaseLabel,
  paid,
  moneyAccounts,
}: {
  purchaseId: string;
  purchaseLabel: string;
  paid: { voucherId: string; voucherNo: string; amountPaisa: number }[];
  moneyAccounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [dateBs, setDateBs] = useState(bsToDbText(today()));
  const [amount, setAmount] = useState("");
  const [moneyId, setMoneyId] = useState(moneyAccounts[0]?.id ?? "");
  const [charge, setCharge] = useState("");
  const [paidTo, setPaidTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const sent = moneyId !== "" && moneyId !== "sys:cash";

  async function submit() {
    const amt = toPaisa(Number(amount) || 0);
    if (amt <= 0) {
      toast.error("Enter the delivery charge.");
      return;
    }
    setBusy(true);
    const res = await recordDeliveryAction({
      purchaseId,
      dateBs,
      amountPaisa: amt,
      moneyAccountId: moneyId,
      transferChargePaisa: sent ? Math.max(0, toPaisa(Number(charge) || 0)) : 0,
      paidTo,
      note,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.userMessage ?? strings.somethingWentWrong);
      return;
    }
    toast.success(`Delivery recorded · ${res.purchaseNo}`);
    setOpen(false);
    setAmount("");
    setCharge("");
    setPaidTo("");
    setNote("");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {paid.map((p) => (
        <Link key={p.voucherId} href={`/accounts/vouchers/${p.voucherId}`} className="text-[13px] text-sage-700 underline-offset-2 hover:underline tnum">
          {formatPaisa(p.amountPaisa)}
        </Link>
      ))}
      <Button variant="ghost" onClick={() => setOpen(true)} className="h-8 px-2 text-[13px]">
        <Truck className="h-4 w-4" />
        Add delivery
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title={`Delivery for ${purchaseLabel}`}>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Date">
              <DatePickerBS value={dateBs} onChange={setDateBs} />
            </Field>
            <Field label="Delivery charge (रू)">
              <Input numeric inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Paid from">
              <Select value={moneyId} onChange={(e) => setMoneyId(e.target.value)}>
                {moneyAccounts.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            {sent ? (
              <Field label="Transfer charge (रू)" hint="Bank or wallet fee, paid on top">
                <Input numeric inputMode="decimal" value={charge} placeholder="0" onChange={(e) => setCharge(e.target.value)} />
              </Field>
            ) : (
              <span />
            )}
          </div>
          <Field label="Paid to">
            <Input value={paidTo} placeholder="Courier or driver" onChange={(e) => setPaidTo(e.target.value)} />
          </Field>
          <Field label="Note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {strings.cancel}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Record delivery"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
