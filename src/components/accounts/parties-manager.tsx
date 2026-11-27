"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { savePartyAction } from "@/app/(app)/accounts/actions";
import { partyHref } from "@/lib/accounts-view";
import { strings } from "@/lib/strings";

interface PartyRow {
  id: string;
  name: string;
  side: "debtor" | "creditor";
  category: string;
  panNo: string;
  phone: string;
  address: string;
  note: string;
  active: boolean;
}

const CATEGORIES: [string, string][] = [
  ["insurance", "Insurance"],
  ["corporate", "Company / corporate client"],
  ["staff", "Staff"],
  ["landlord", "Landlord"],
  ["lender", "Lender"],
  ["other", "Other"],
];

const EMPTY: PartyRow = { id: "", name: "", side: "creditor", category: "other", panNo: "", phone: "", address: "", note: "", active: true };

export function PartiesManager({ parties, canEdit }: { parties: PartyRow[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<PartyRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!editing) return;
    setBusy(true);
    const res = await savePartyAction({ ...editing, id: editing.id || undefined });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.userMessage ?? strings.somethingWentWrong);
      return;
    }
    toast.success("Saved");
    setEditing(null);
    router.refresh();
  }

  const set = <K extends keyof PartyRow>(k: K, v: PartyRow[K]) => setEditing((e) => (e ? { ...e, [k]: v } : e));

  return (
    <>
      {canEdit && (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => setEditing({ ...EMPTY })}>
            <Plus className="h-4 w-4" /> Add a person or company
          </Button>
        </div>
      )}
      {parties.length === 0 ? (
        <EmptyState icon={Users} message="No people or companies added yet." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Kind</TH>
              <TH>Usually</TH>
              <TH>Phone</TH>
              <TH> </TH>
            </TR>
          </THead>
          <tbody>
            {parties.map((p) => (
              <TR key={p.id}>
                <TD>
                  <Link href={partyHref("party", p.id)} className="font-medium text-sage-900 hover:underline">
                    {p.name}
                  </Link>
                  {!p.active && (
                    <Badge tone="neutral" className="ml-2">
                      Off
                    </Badge>
                  )}
                </TD>
                <TD>{CATEGORIES.find(([k]) => k === p.category)?.[1] ?? "Other"}</TD>
                <TD>{p.side === "debtor" ? "Owes the clinic" : "The clinic owes them"}</TD>
                <TD>{p.phone}</TD>
                <TD className="text-right">
                  {canEdit && (
                    <button className="text-[13px] font-medium text-sage-700 hover:underline" onClick={() => setEditing({ ...p })}>
                      Edit
                    </button>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing?.id ? "Edit person or company" : "Add a person or company"}>
        {editing && (
          <div className="flex flex-col gap-4">
            <Field label="Name">
              <Input value={editing.name} autoFocus onChange={(e) => set("name", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Kind">
                <Select value={editing.category} onChange={(e) => set("category", e.target.value)}>
                  {CATEGORIES.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Usually">
                <Select value={editing.side} onChange={(e) => set("side", e.target.value as PartyRow["side"])}>
                  <option value="creditor">The clinic owes them</option>
                  <option value="debtor">They owe the clinic</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="PAN">
                <Input value={editing.panNo} onChange={(e) => set("panNo", e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input value={editing.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
            </div>
            <Field label="Address">
              <Input value={editing.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <Field label="Note">
              <Input value={editing.note} onChange={(e) => set("note", e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="checkbox" checked={editing.active} onChange={(e) => set("active", e.target.checked)} /> In use
            </label>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditing(null)}>
            {strings.cancel}
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
