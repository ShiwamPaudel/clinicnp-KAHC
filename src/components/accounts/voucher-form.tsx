"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DatePickerBS } from "@/components/ui/date-picker-bs";
import { useToast } from "@/components/ui/toast";
import { createVoucherAction } from "@/app/(app)/accounts/actions";
import { formatPaisa, toPaisa } from "@/lib/money";
import {
  PARTY_TYPE_LABEL,
  VOUCHER_LABEL,
  voucherPartyTypes,
  type PartyType,
  type VoucherType,
} from "@/lib/accounting";
import { strings } from "@/lib/strings";

export interface AccountOption {
  id: string;
  code: string;
  name: string;
  kind: string;
  grp: string;
  isControl: boolean;
  autoOnly: boolean;
}

export interface PartyOption {
  partyType: PartyType;
  partyId: string;
  name: string;
  accountId: string;
}

interface Row {
  key: number;
  /** "a:<account id>" or "p:<party type>:<party id>" */
  target: string;
  amount: string;
  debit: string;
  credit: string;
  note: string;
  refNo: string;
  refDateBs: string;
}

let nextKey = 1;
const blankRow = (target = ""): Row => ({ key: nextKey++, target, amount: "", debit: "", credit: "", note: "", refNo: "", refDateBs: "" });

const rupees = (s: string) => toPaisa(Number(s.replace(/,/g, "")) || 0);

const HELP: Record<VoucherType, string> = {
  payment: "Rent, salaries, bills, a doctor's payout, a loan repaid.",
  receipt: "Capital, a loan, other income.",
  contra: "Cash deposited, cash withdrawn, wallet money paid into the bank.",
  journal: "Corrections, and moving opening balances to capital.",
  opening: "What the clinic owned and owed on its first day here.",
};

export function VoucherForm({
  type,
  todayBs,
  accounts,
  parties,
  initialParty,
}: {
  type: VoucherType;
  todayBs: string;
  accounts: AccountOption[];
  parties: PartyOption[];
  initialParty?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const money = accounts.filter((a) => a.grp === "cash_bank");
  const allowedParties = voucherPartyTypes(type);
  const partyChoices = parties.filter((p) => allowedParties.includes(p.partyType));
  const accountChoices = accounts.filter((a) => {
    if (a.isControl || a.autoOnly) return false;
    if ((type === "payment" || type === "receipt") && a.grp === "cash_bank") return false;
    if (type === "opening" && (a.kind === "income" || a.kind === "expense")) return false;
    return true;
  });

  const [dateBs, setDateBs] = useState(todayBs);
  const [narration, setNarration] = useState("");
  const [moneyId, setMoneyId] = useState(money[0]?.id ?? "");
  const [toId, setToId] = useState(money[1]?.id ?? "");
  const [contraAmount, setContraAmount] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [blankRow(initialParty ?? ""), ...(type === "journal" ? [blankRow()] : [])]);
  const [busy, setBusy] = useState(false);

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const isParty = (target: string) => target.startsWith("p:");

  function lineFor(target: string, debitPaisa: number, creditPaisa: number, r?: Row) {
    if (target.startsWith("p:")) {
      const [, pt, ...rest] = target.split(":");
      const pid = rest.join(":");
      const party = partyChoices.find((p) => p.partyType === pt && p.partyId === pid);
      return {
        accountId: party?.accountId ?? "",
        partyType: (pt ?? null) as PartyType | null,
        partyId: pid || null,
        debitPaisa,
        creditPaisa,
        refNo: r?.refNo ?? "",
        refDateBs: r?.refDateBs || null,
        note: r?.note ?? "",
      };
    }
    return {
      accountId: target.slice(2),
      partyType: null,
      partyId: null,
      debitPaisa,
      creditPaisa,
      refNo: "",
      refDateBs: null,
      note: r?.note ?? "",
    };
  }

  const built = useMemo(() => {
    if (type === "contra") {
      const amt = rupees(contraAmount);
      return [lineFor(`a:${toId}`, amt, 0), lineFor(`a:${moneyId}`, 0, amt)];
    }
    if (type === "payment" || type === "receipt") {
      const used = rows.filter((r) => r.target && rupees(r.amount) > 0);
      const total = used.reduce((s, r) => s + rupees(r.amount), 0);
      const lines = used.map((r) => (type === "payment" ? lineFor(r.target, rupees(r.amount), 0, r) : lineFor(r.target, 0, rupees(r.amount), r)));
      lines.push(type === "payment" ? lineFor(`a:${moneyId}`, 0, total) : lineFor(`a:${moneyId}`, total, 0));
      return lines;
    }
    return rows.filter((r) => r.target && (rupees(r.debit) > 0 || rupees(r.credit) > 0)).map((r) => lineFor(r.target, rupees(r.debit), rupees(r.credit), r));
    // lineFor reads only props and the rows passed in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, rows, moneyId, toId, contraAmount]);

  const dr = built.reduce((s, l) => s + l.debitPaisa, 0);
  const cr = built.reduce((s, l) => s + l.creditPaisa, 0);

  async function save() {
    setBusy(true);
    const res = await createVoucherAction({ type, dateBs, narration, lines: built });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.userMessage ?? strings.somethingWentWrong);
      return;
    }
    toast.success(`Saved as ${res.voucherNo}`);
    router.push(`/accounts/vouchers/${res.id}`);
  }

  const targetSelect = (r: Row) => (
    <Select value={r.target} onChange={(e) => setRow(r.key, { target: e.target.value })}>
      <option value="">Choose…</option>
      {partyChoices.length > 0 && (
        <optgroup label="People">
          {partyChoices.map((p) => (
            <option key={`${p.partyType}:${p.partyId}`} value={`p:${p.partyType}:${p.partyId}`}>
              {p.name} — {PARTY_TYPE_LABEL[p.partyType]}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Accounts">
        {accountChoices.map((a) => (
          <option key={a.id} value={`a:${a.id}`}>
            {a.code} · {a.name}
          </option>
        ))}
      </optgroup>
    </Select>
  );

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] text-sage-600">{HELP[type]}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Date">
          <DatePickerBS value={dateBs} onChange={setDateBs} />
        </Field>
        {(type === "payment" || type === "receipt" || type === "contra") && (
          <Field label={type === "payment" ? "Paid from" : type === "receipt" ? "Received into" : "From"}>
            <Select value={moneyId} onChange={(e) => setMoneyId(e.target.value)}>
              {money.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {type === "contra" && (
          <Field label="To">
            <Select value={toId} onChange={(e) => setToId(e.target.value)}>
              {money.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {type === "contra" ? (
        <div className="max-w-[240px]">
          <Field label="Amount (रू)">
            <Input numeric inputMode="decimal" value={contraAmount} onChange={(e) => setContraAmount(e.target.value)} />
          </Field>
        </div>
      ) : (
        <div className="rounded-[10px] border border-line bg-cream-50 p-4">
          <div className="flex flex-col gap-3">
            {rows.map((r) => (
              <div key={r.key} className="grid items-end gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]">
                <Field label={type === "payment" ? "Paid for" : type === "receipt" ? "Received for" : "Account or person"}>
                  {targetSelect(r)}
                </Field>
                {type === "payment" || type === "receipt" ? (
                  <>
                    <Field label="Amount (रू)">
                      <Input numeric inputMode="decimal" value={r.amount} onChange={(e) => setRow(r.key, { amount: e.target.value })} />
                    </Field>
                    <span />
                  </>
                ) : (
                  <>
                    <Field label={type === "opening" ? "Owned / owed to us" : "Debit (रू)"}>
                      <Input numeric inputMode="decimal" value={r.debit} onChange={(e) => setRow(r.key, { debit: e.target.value, credit: "" })} />
                    </Field>
                    <Field label={type === "opening" ? "Owed by us" : "Credit (रू)"}>
                      <Input numeric inputMode="decimal" value={r.credit} onChange={(e) => setRow(r.key, { credit: e.target.value, debit: "" })} />
                    </Field>
                  </>
                )}
                {type === "opening" && isParty(r.target) ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Old bill no.">
                      <Input value={r.refNo} onChange={(e) => setRow(r.key, { refNo: e.target.value })} />
                    </Field>
                    <Field label="Bill date">
                      <DatePickerBS value={r.refDateBs} onChange={(v) => setRow(r.key, { refDateBs: v })} clearable />
                    </Field>
                  </div>
                ) : (
                  <Field label="Note">
                    <Input value={r.note} onChange={(e) => setRow(r.key, { note: e.target.value })} />
                  </Field>
                )}
                <Button
                  variant="ghost"
                  aria-label="Remove line"
                  onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : rs))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Button variant="secondary" onClick={() => setRows((rs) => [...rs, blankRow()])}>
              <Plus className="h-4 w-4" /> Add a line
            </Button>
            <div className="text-[14px] text-sage-700 tnum">
              {type === "payment" || type === "receipt" ? (
                <>Total {formatPaisa(type === "payment" ? dr : cr)}</>
              ) : (
                <>
                  Debit {formatPaisa(dr)} · Credit {formatPaisa(cr)}
                  {type === "journal" && dr !== cr && <span className="ml-2 font-semibold text-danger-600">Not equal yet</span>}
                  {type === "opening" && dr !== cr && (
                    <span className="ml-2 text-sage-500">Difference {formatPaisa(Math.abs(dr - cr))}</span>
                  )}
                </>
              )}
            </div>
          </div>
          {type === "opening" && (
            <p className="mt-2 text-[12px] text-sage-500">
              Enter each old bill on its own line with its number and date.
            </p>
          )}
        </div>
      )}

      <Field label="Narration">
        <Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="What this was for" />
      </Field>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()}>
          {strings.cancel}
        </Button>
        <Button onClick={save} disabled={busy || dr + cr === 0}>
          {busy ? "Saving…" : `Save ${VOUCHER_LABEL[type].toLowerCase()}`}
        </Button>
      </div>
    </div>
  );
}
