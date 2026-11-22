"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Field } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { savePackageAction } from "@/app/(app)/lab/actions";
import { formatPaisa, toPaisa, paisaToRupees } from "@/lib/money";
import { strings } from "@/lib/strings";
import type { LabProfile } from "@/lib/repos/lab-catalog";

interface TestOption {
  id: string;
  name: string;
}

interface ProfileOption {
  id: string;
  name: string;
  testIds: string[];
}

interface Draft {
  id?: string;
  name: string;
  shortCode: string;
  active: boolean;
  rate: string;
  vatApplicable: boolean;
  profileIds: string[];
  testIds: string[];
}

/** How many different tests a package opens: its profiles' tests and its own, each once. */
function testCount(profileIds: string[], testIds: string[], profiles: ProfileOption[]): number {
  const all = new Set(testIds);
  for (const id of profileIds) for (const t of profiles.find((p) => p.id === id)?.testIds ?? []) all.add(t);
  return all.size;
}

/** Lab → Packages: profiles and tests billed together at one price, like a whole-body check-up. */
export function PackageManager({
  packages,
  profiles,
  tests,
}: {
  packages: LabProfile[];
  profiles: ProfileOption[];
  tests: TestOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<Draft | null>(null);
  const [filter, setFilter] = useState("");
  const [pending, start] = useTransition();
  const set = (patch: Partial<Draft>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const q = filter.trim().toLowerCase();
  const shownProfiles = useMemo(() => profiles.filter((p) => p.name.toLowerCase().includes(q)), [profiles, q]);
  const shownTests = useMemo(() => tests.filter((t) => t.name.toLowerCase().includes(q)), [tests, q]);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  function save() {
    if (!form) return;
    const rate = Number(form.rate || "0");
    if (!Number.isFinite(rate) || rate < 0) return toast.error("The price has to be a number.");
    start(async () => {
      const res = await savePackageAction({
        id: form.id,
        name: form.name,
        shortCode: form.shortCode,
        departmentId: null,
        active: form.active,
        ratePaisa: toPaisa(rate),
        vatApplicable: form.vatApplicable,
        profileIds: form.profileIds,
        testIds: form.testIds,
      });
      if (res.ok) {
        toast.success(strings.saved);
        setForm(null);
        setFilter("");
        router.refresh();
      } else toast.error(res.userMessage ?? strings.somethingWentWrong);
    });
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button
          onClick={() =>
            setForm({ name: "", shortCode: "", active: true, rate: "", vatApplicable: false, profileIds: [], testIds: [] })
          }
        >
          <Plus className="h-4 w-4" />
          Add package
        </Button>
      </div>
      {packages.length === 0 ? (
        <EmptyState icon={Package} message="No packages yet. A package bills profiles and tests together at one price." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Package</TH>
              <TH>What is in it</TH>
              <TH numeric>Tests</TH>
              <TH numeric>Price</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <tbody>
            {packages.map((p) => (
              <TR key={p.id}>
                <TD>
                  <div className="font-medium text-sage-900">{p.name}</div>
                  {p.shortCode && <div className="text-[12px] text-sage-500">{p.shortCode}</div>}
                </TD>
                <TD className="max-w-[460px] text-[13px] text-sage-700">
                  {p.profileNames.length > 0 && <span className="font-medium text-sage-900">{p.profileNames.join(", ")}</span>}
                  {p.profileNames.length > 0 && p.testNames.length > 0 && " · "}
                  {p.testNames.join(", ")}
                </TD>
                <TD numeric>{testCount(p.profileIds, p.testIds, profiles)}</TD>
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
                        active: p.active,
                        rate: String(paisaToRupees(p.ratePaisa)),
                        vatApplicable: p.vatApplicable,
                        profileIds: p.profileIds,
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
        onClose={() => {
          setForm(null);
          setFilter("");
        }}
        title={form?.id ? `Edit ${form.name}` : "Add package"}
        className="max-w-3xl"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setForm(null);
                setFilter("");
              }}
            >
              {strings.cancel}
            </Button>
            <Button onClick={save} disabled={pending}>
              {strings.save}
            </Button>
          </>
        }
      >
        {form && (
          <div className="flex max-h-[72vh] flex-col gap-3 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name">
                <Input value={form.name} placeholder="Whole Body Test" onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Short code">
                <Input value={form.shortCode} onChange={(e) => set({ shortCode: e.target.value })} />
              </Field>
              <Field label="Price (Rs)">
                <Input value={form.rate} inputMode="decimal" onChange={(e) => set({ rate: e.target.value })} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-[14px]">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /> In use
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.vatApplicable} onChange={(e) => set({ vatApplicable: e.target.checked })} /> VAT
                applies
              </label>
              <span className="ml-auto text-[13px] text-sage-600">
                {form.profileIds.length} profile{form.profileIds.length === 1 ? "" : "s"} · {form.testIds.length} test
                {form.testIds.length === 1 ? "" : "s"} · {testCount(form.profileIds, form.testIds, profiles)} tests in all
              </span>
            </div>
            <Input value={filter} placeholder="Find a profile or test" onChange={(e) => setFilter(e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[13px] font-semibold text-sage-900">Profiles</div>
                <div className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-[8px] border border-line p-2">
                  {shownProfiles.length === 0 && <span className="text-[13px] text-sage-500">No profile matches.</span>}
                  {shownProfiles.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-[14px]">
                      <input
                        type="checkbox"
                        checked={form.profileIds.includes(p.id)}
                        onChange={() => set({ profileIds: toggle(form.profileIds, p.id) })}
                      />
                      {p.name}
                      <span className="text-[12px] text-sage-500">{p.testIds.length}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[13px] font-semibold text-sage-900">Tests</div>
                <div className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-[8px] border border-line p-2">
                  {shownTests.length === 0 && <span className="text-[13px] text-sage-500">No test matches.</span>}
                  {shownTests.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 text-[14px]">
                      <input
                        type="checkbox"
                        checked={form.testIds.includes(t.id)}
                        onChange={() => set({ testIds: toggle(form.testIds, t.id) })}
                      />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
