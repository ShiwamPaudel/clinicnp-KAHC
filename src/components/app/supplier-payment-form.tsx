"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DatePickerBS } from "@/components/ui/date-picker-bs";
import { useToast } from "@/components/ui/toast";
import { recordPaymentAction } from "@/app/(app)/suppliers/actions";
import { toPaisa } from "@/lib/money";
import { bsToDbText, today } from "@/lib/bs";
import { strings } from "@/lib/strings";

export function SupplierPaymentForm({
  supplierId,
  banks = [],
  purchases = [],
}: {
  supplierId: string;
  /** the clinic's bank accounts (Accounts > Chart of accounts) */
  banks?: { id: string; name: string }[];
  /** this supplier's recent purchase bills, newest first */
  purchases?: { id: string; label: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [dateBs, setDateBs] = useState(bsToDbText(today()));
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [bankId, setBankId] = useState("");
  const [charge, setCharge] = useState("");
  const [purchaseId, setPurchaseId] = useState("");
  const [busy, setBusy] = useState(false);
  const bankPaid = method === "bank" || method === "cheque";
  // the bank's or wallet's own fee: only when the money is sent, not handed over
  const sent = bankPaid || method === "qr";

  async function submit() {
    const amt = toPaisa(Number(amount) || 0);
    if (amt <= 0) {
      toast.error("Enter an amount.");
      return;
    }
    const chargePaisa = sent ? toPaisa(Number(charge) || 0) : 0;
    if (chargePaisa < 0) {
      toast.error("The transfer charge cannot be below zero.");
      return;
    }
    setBusy(true);
    const res = await recordPaymentAction({
      supplierId,
      dateBs,
      amountPaisa: amt,
      method,
      note,
      accountId: bankPaid && bankId ? bankId : null,
      transferChargePaisa: chargePaisa,
      purchaseId: purchaseId || null,
    });
    setBusy(false);
    if (res.ok) {
      toast.success("Payment recorded");
      setAmount("");
      setNote("");
      setCharge("");
      setPurchaseId("");
      router.refresh();
    } else {
      toast.error(res.userMessage ?? strings.somethingWentWrong);
    }
  }

  return (
    <div className="rounded-[10px] border border-line bg-cream-50 p-5">
      <h2 className="mb-3 text-[15px] font-semibold text-sage-900">
        Record a payment
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date">
          <DatePickerBS value={dateBs} onChange={setDateBs} />
        </Field>
        <Field label="Amount (रू)">
          <Input
            numeric
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="qr">QR / wallet</option>
            <option value="bank">Bank</option>
            <option value="cheque">Cheque</option>
          </Select>
        </Field>
        {sent && (
          <Field label="Transfer charge (रू)" hint="Bank or wallet fee, paid on top">
            <Input
              numeric
              inputMode="decimal"
              value={charge}
              placeholder="0"
              onChange={(e) => setCharge(e.target.value)}
            />
          </Field>
        )}
        {bankPaid && banks.length > 0 && (
          <Field label="From which bank">
            <Select value={bankId} onChange={(e) => setBankId(e.target.value)}>
              <option value="">Choose…</option>
              {banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {purchases.length > 0 && (
          <Field label="For which bill">
            <Select value={purchaseId} onChange={(e) => setPurchaseId(e.target.value)}>
              <option value="">Not one bill</option>
              {purchases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex justify-end">
        <Button onClick={submit} disabled={busy}>
          Record payment
        </Button>
      </div>
    </div>
  );
}
