"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { saveProfileAction } from "@/app/(app)/lab/actions";
import { formatPaisa, toPaisa, paisaToRupees } from "@/lib/money";
import { strings } from "@/lib/strings";
import type { LabProfile } from "@/lib/repos/lab-catalog";

interface Option {
  id: string;
  name: string;
}

interface Draft {
  id?: string;
  name: string;
  shortCode: string;
  departmentId: string;
  active: boolean;
  rate: string;
  vatApplicable: boolean;
  testIds: string[];
}

/** Lab → Profiles: several tests billed as one line, each reported on its own. */
export function ProfileManager({ profiles, tests, departments }: { profiles: LabProfile[]; tests: Option[]; departments: Option[] }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<Draft | null>(null);
  const [filter, setFilter] = useState("");
  const [pending, start] = useTransition();
  const set = (patch: Partial<Draft>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const shownTests = useMemo(
    () => tests.filter((t) => t.name.toLowerCase().includes(filter.trim().toLowerCase())),
    [tests, filter],
  );

  function save() {
    if (!form) return;
    const rate = Number(form.rate || "0");
    if (!Number.isFinite(rate) || rate < 0) return toast.error("The price has to be a number.");
    start(async () => {
      const res = await saveProfileAction({
        id: form.id,
        name: form.name,
        shortCode: form.shortCode,
        departmentId: form.departmentId || null,
        active: form.active,
        ratePaisa: toPaisa(rate),
        vatApplicable: form.vatApplicable,
        testIds: form.testIds,
      });
      if (res.ok) {
        toast.success(strings.saved);
        setForm(null);
        router.refresh();
      } else toast.error(res.userMessage ?? strings.somethingWentWrong);
    });
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() =>
            setForm({ name: "", shortCode: "", departmentId: "", active: true, rate: "", vatApplicable: false, testIds: [] })
          }
        >
          <Plus className="h-4 w-4" />
          Add profile
        </Button>
      </div>
      {profiles.length === 0 ? (
        <EmptyState icon={Layers} message="No profiles yet. A profile bills several tests as one line, like a blood count." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Profile</TH>
              <TH>Tests in it</TH>
              <TH numeric>Price</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <tbody>
            {profiles.map((p) => (
              <TR key={p.id}>
                <TD>
                  <div className="font-medium text-sage-900">{p.name}</div>
                  <div className="text-[12px] text-sage-500">{[p.shortCode, p.departmentName].filter(Boolean).join(" · ")}</div>
                </TD>
                <TD className="max-w-[420px] text-[13px] text-sage-700">{p.testNames.join(", ")}</TD>
                <TD numeric>{formatPaisa(p.ratePaisa)}</TD>
                <TD>{p.active ? <Badge tone="ok">Billed</Badge> : <Badge tone="danger">Off</Badge>}</TD>
                <TD className="text-right">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setForm({
                        id: p.id,
                        name: p.name,
                        shortCode: p.shortCode,
                        departmentId: p.departmentId ?? "",
                        active: p.active,
                        rate: String(paisaToRupees(p.ratePaisa)),
                        vatApplicable: p.vatApplicable,
                        testIds: p.testIds,
                      })
                    }
                  >
                    {strings.edit}
                  </Button>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? `Edit ${form.name}` : "Add profile"}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              {strings.cancel}
            </Button>
            <Button onClick={save} disabled={pending}>
              {strings.save}
            </Button>
          </>
        }
      >
        {form && (
          <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Short code">
                <Input value={form.shortCode} onChange={(e) => set({ shortCode: e.target.value })} />
              </Field>
              <Field label="Section">
                <Select value={form.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
                  <option value="">-</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Price (Rs)">
                <Input value={form.rate} inputMode="decimal" onChange={(e) => set({ rate: e.target.value })} />
              </Field>
            </div>
            <div className="flex gap-4 text-[14px]">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /> In use
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.vatApplicable} onChange={(e) => set({ vatApplicable: e.target.checked })} /> VAT
                applies
              </label>
            </div>
            <Field label={`Tests in this profile (${form.testIds.length})`}>
              <Input value={filter} placeholder="Find a test" onChange={(e) => setFilter(e.target.value)} />
            </Field>
            <div className="grid max-h-64 gap-1 overflow-y-auto rounded-[8px] border border-line p-2 sm:grid-cols-2">
              {shownTests.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-[14px]">
                  <input
                    type="checkbox"
                    checked={form.testIds.includes(t.id)}
                    onChange={() =>
                      set({
                        testIds: form.testIds.includes(t.id) ? form.testIds.filter((x) => x !== t.id) : [...form.testIds, t.id],
                      })
                    }
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
