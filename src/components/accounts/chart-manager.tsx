"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { saveAccountAction, deleteAccountAction } from "@/app/(app)/accounts/actions";
import { ACCOUNT_GROUPS, ACCOUNT_KINDS, KIND_LABEL, SEGMENT_LABEL, type AccountKind, type Segment } from "@/lib/accounting";
import { formatPaisa } from "@/lib/money";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/cn";

interface Row {
  id: string;
  code: string;
  name: string;
  kind: AccountKind;
  grp: string;
  segment: string | null;
  isBank: boolean;
  isSystem: boolean;
  isControl: boolean;
  inUse: boolean;
  note: string;
  active: boolean;
  balancePaisa: number;
}

interface Draft {
  id: string;
  code: string;
  name: string;
  grp: string;
  segment: string;
  isBank: boolean;
  note: string;
  active: boolean;
  isSystem: boolean;
  inUse: boolean;
}

const GROUPS = Object.entries(ACCOUNT_GROUPS) as [string, { label: string; kind: AccountKind }][];

export function ChartManager({ accounts, canEdit, showBalances }: { accounts: Row[]; canEdit: boolean; showBalances: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [showOff, setShowOff] = useState(false);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  async function save() {
    if (!draft) return;
    setBusy(true);
    const res = await saveAccountAction({
      id: draft.id || undefined,
      code: draft.code,
      name: draft.name,
      grp: draft.grp,
      isBank: draft.isBank,
      segment: draft.segment === "pharmacy" || draft.segment === "clinic" || draft.segment === "lab" ? draft.segment : null,
      note: draft.note,
      active: draft.active,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.userMessage ?? strings.somethingWentWrong);
      return;
    }
    toast.success("Saved");
    setDraft(null);
    router.refresh();
  }

  async function remove() {
    if (!draft?.id) return;
    setBusy(true);
    const res = await deleteAccountAction(draft.id);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.userMessage ?? strings.somethingWentWrong);
      return;
    }
    toast.success("Removed");
    setDraft(null);
    router.refresh();
  }

  const shown = accounts.filter((a) => showOff || a.active);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[13px] text-sage-600">
          <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> Show accounts that are switched off
        </label>
        {canEdit && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => setDraft({ id: "", code: "", name: "", grp: "cash_bank", segment: "", isBank: true, note: "", active: true, isSystem: false, inUse: false })}
            >
              <Plus className="h-4 w-4" /> Add a bank account
            </Button>
            <Button
              onClick={() => setDraft({ id: "", code: "", name: "", grp: "indirect_expense", segment: "", isBank: false, note: "", active: true, isSystem: false, inUse: false })}
            >
              <Plus className="h-4 w-4" /> Add an account
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-5">
        {ACCOUNT_KINDS.map((kind) => {
          const list = shown.filter((a) => a.kind === kind);
          if (list.length === 0) return null;
          return (
            <section key={kind}>
              <h3 className="mb-2 text-[14px] font-semibold text-sage-900">{KIND_LABEL[kind]}</h3>
              <Table>
                <THead>
                  <TR>
                    <TH>Code</TH>
                    <TH>Account</TH>
                    <TH>Heading</TH>
                    <TH>Part</TH>
                    {showBalances && <TH numeric>Balance today</TH>}
                    <TH> </TH>
                  </TR>
                </THead>
                <tbody>
                  {list.map((a) => (
                    <TR key={a.id} className={cn(!a.active && "opacity-60")}>
                      <TD className="tnum text-sage-600">{a.code}</TD>
                      <TD>
                        <Link href={`/accounts/ledger/${encodeURIComponent(a.id)}`} className="font-medium text-sage-900 hover:underline">
                          {a.name}
                        </Link>
                        {a.isBank && a.grp === "cash_bank" && !a.isSystem && <Badge tone="info" className="ml-2">Bank</Badge>}
                        {a.isSystem && <Badge tone="neutral" className="ml-2">Filled by the app</Badge>}
                        {!a.active && <Badge tone="neutral" className="ml-2">Off</Badge>}
                      </TD>
                      <TD className="text-[13px] text-sage-600">{ACCOUNT_GROUPS[a.grp as keyof typeof ACCOUNT_GROUPS]?.label ?? a.grp}</TD>
                      <TD className="text-[13px] text-sage-600">{a.segment ? SEGMENT_LABEL[a.segment as Segment] : ""}</TD>
                      {showBalances && <TD numeric>{a.balancePaisa ? formatPaisa(a.balancePaisa, false) : ""}</TD>}
                      <TD className="text-right">
                        {canEdit && (
                          <button
                            className="text-[13px] font-medium text-sage-700 hover:underline"
                            onClick={() =>
                              setDraft({
                                id: a.id,
                                code: a.code,
                                name: a.name,
                                grp: a.grp,
                                segment: a.segment ?? "",
                                isBank: a.isBank,
                                note: a.note,
                                active: a.active,
                                isSystem: a.isSystem,
                                inUse: a.inUse,
                              })
                            }
                          >
                            Edit
                          </button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </section>
          );
        })}
      </div>

      <Dialog open={draft !== null} onClose={() => setDraft(null)} title={draft?.id ? "Edit account" : "Add an account"}>
        {draft && (
          <div className="flex flex-col gap-4">
            {draft.isSystem && (
              <p className="rounded-[8px] bg-sage-75 px-3 py-2 text-[13px] text-sage-700">
                The app fills this account by itself. Its code and name can change; what it does cannot.
              </p>
            )}
            <div className="grid grid-cols-[120px_1fr] gap-4">
              <Field label="Code">
                <Input value={draft.code} onChange={(e) => set("code", e.target.value)} />
              </Field>
              <Field label="Name">
                <Input value={draft.name} autoFocus onChange={(e) => set("name", e.target.value)} />
              </Field>
            </div>
            {!draft.isSystem && (
              <>
                <Field label="Heading" hint={draft.inUse ? "It already has entries, so it stays the same kind." : undefined}>
                  <Select value={draft.grp} onChange={(e) => set("grp", e.target.value)}>
                    {GROUPS.map(([k, g]) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[g.kind]} — {g.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {draft.grp === "cash_bank" && (
                  <label className="flex items-center gap-2 text-[14px]">
                    <input type="checkbox" checked={draft.isBank} onChange={(e) => set("isBank", e.target.checked)} />
                    A bank account (offered when a supplier or laboratory is paid by bank or cheque)
                  </label>
                )}
                {(ACCOUNT_GROUPS[draft.grp as keyof typeof ACCOUNT_GROUPS]?.kind === "income" ||
                  ACCOUNT_GROUPS[draft.grp as keyof typeof ACCOUNT_GROUPS]?.kind === "expense") && (
                  <Field label="Part of the clinic" hint="Where it shows in profit and loss">
                    <Select value={draft.segment} onChange={(e) => set("segment", e.target.value)}>
                      <option value="">Whole clinic</option>
                      <option value="pharmacy">Pharmacy</option>
                      <option value="clinic">Clinic</option>
                      <option value="lab">Laboratory</option>
                    </Select>
                  </Field>
                )}
                <label className="flex items-center gap-2 text-[14px]">
                  <input type="checkbox" checked={draft.active} onChange={(e) => set("active", e.target.checked)} /> In use
                </label>
              </>
            )}
            <Field label="Note">
              <Input value={draft.note} onChange={(e) => set("note", e.target.value)} placeholder="Account number, branch…" />
            </Field>
          </div>
        )}
        <div className="mt-5 flex justify-between gap-2">
          <div>
            {draft?.id && !draft.isSystem && !draft.inUse && (
              <Button variant="ghost" onClick={remove} disabled={busy}>
                Remove
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDraft(null)}>
              {strings.cancel}
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
