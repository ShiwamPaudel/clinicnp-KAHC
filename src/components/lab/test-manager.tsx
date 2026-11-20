"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Beaker, Plus, Trash2, ArrowUp, ArrowDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { saveTestAction } from "@/app/(app)/lab/actions";
import { formatPaisa, toPaisa, paisaToRupees } from "@/lib/money";
import { strings } from "@/lib/strings";
import { RangeEditor, rangeToDraft, draftToRange, EMPTY_RANGE, type RangeDraft } from "@/components/lab/range-editor";
import type { LabTest, LabResultType, LabParamType } from "@/lib/repos/lab-catalog";

interface Option {
  id: string;
  name: string;
}

interface ParamDraft {
  id?: string;
  name: string;
  unit: string;
  resultType: LabParamType;
  options: string;
  defaultRemarks: string;
  range: RangeDraft;
}

interface TestDraft {
  id?: string;
  name: string;
  shortCode: string;
  departmentId: string;
  sampleTypeId: string;
  method: string;
  description: string;
  resultType: LabResultType;
  unit: string;
  options: string;
  defaultRemarks: string;
  tatHours: string;
  sortOrder: string;
  active: boolean;
  billable: boolean;
  rate: string;
  vatApplicable: boolean;
  range: RangeDraft;
  parameters: ParamDraft[];
}

const TYPE_LABEL: Record<LabResultType, string> = {
  numeric: "A number",
  text: "Words",
  select: "Pick from a list",
  pos_neg: "Positive / Negative",
  multi: "Several values (a panel)",
};

const emptyDraft = (): TestDraft => ({
  name: "",
  shortCode: "",
  departmentId: "",
  sampleTypeId: "",
  method: "",
  description: "",
  resultType: "numeric",
  unit: "",
  options: "",
  defaultRemarks: "",
  tatHours: "",
  sortOrder: "0",
  active: true,
  billable: true,
  rate: "",
  vatApplicable: false,
  range: EMPTY_RANGE,
  parameters: [],
});

function toDraft(t: LabTest): TestDraft {
  return {
    id: t.id,
    name: t.name,
    shortCode: t.shortCode,
    departmentId: t.departmentId ?? "",
    sampleTypeId: t.sampleTypeId ?? "",
    method: t.method,
    description: t.description,
    resultType: t.resultType,
    unit: t.unit,
    options: t.selectOptions.join(", "),
    defaultRemarks: t.defaultRemarks,
    tatHours: t.tatHours == null ? "" : String(t.tatHours),
    sortOrder: String(t.sortOrder),
    active: t.active,
    billable: t.billable,
    rate: String(paisaToRupees(t.ratePaisa)),
    vatApplicable: t.vatApplicable,
    range: rangeToDraft(t),
    parameters: t.parameters.map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      resultType: p.resultType,
      options: p.selectOptions.join(", "),
      defaultRemarks: p.defaultRemarks,
      range: rangeToDraft(p),
    })),
  };
}

const splitOptions = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Lab → Tests. Each test is billed at the counter under the price set here.
 * Reference ranges are the lab in-charge's to enter; nothing is filled in.
 */
export function TestManager({ tests, departments, sampleTypes }: { tests: LabTest[]; departments: Option[]; sampleTypes: Option[] }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<TestDraft | null>(null);
  const [pending, start] = useTransition();
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? tests.filter((x) => x.name.toLowerCase().includes(t) || x.shortCode.toLowerCase().includes(t)) : tests;
  }, [q, tests]);

  const set = (patch: Partial<TestDraft>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const setP = (i: number, patch: Partial<ParamDraft>) =>
    setForm((f) => (f ? { ...f, parameters: f.parameters.map((p, j) => (j === i ? { ...p, ...patch } : p)) } : f));
  const moveP = (i: number, by: number) =>
    setForm((f) => {
      if (!f) return f;
      const list = [...f.parameters];
      const j = i + by;
      if (j < 0 || j >= list.length) return f;
      [list[i], list[j]] = [list[j]!, list[i]!];
      return { ...f, parameters: list };
    });

  function save() {
    if (!form) return;
    let payload;
    try {
      const rateNum = Number(form.rate || "0");
      if (!Number.isFinite(rateNum) || rateNum < 0) throw new Error("The price has to be a number.");
      payload = {
        id: form.id,
        name: form.name,
        shortCode: form.shortCode,
        departmentId: form.departmentId || null,
        sampleTypeId: form.sampleTypeId || null,
        method: form.method,
        description: form.description,
        resultType: form.resultType,
        unit: form.unit,
        selectOptions: splitOptions(form.options),
        defaultRemarks: form.defaultRemarks,
        tatHours: form.tatHours.trim() ? Math.trunc(Number(form.tatHours)) : null,
        sortOrder: Math.trunc(Number(form.sortOrder || "0")) || 0,
        active: form.active,
        billable: form.billable,
        ratePaisa: toPaisa(rateNum),
        vatApplicable: form.vatApplicable,
        ...draftToRange(form.range),
        parameters:
          form.resultType === "multi"
            ? form.parameters.map((p) => ({
                id: p.id,
                name: p.name,
                unit: p.unit,
                resultType: p.resultType,
                selectOptions: splitOptions(p.options),
                defaultRemarks: p.defaultRemarks,
                ...draftToRange(p.range),
              }))
            : [],
      };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : strings.somethingWentWrong);
      return;
    }
    start(async () => {
      const res = await saveTestAction(payload);
      if (res.ok) {
        toast.success(strings.saved);
        setForm(null);
        router.refresh();
      } else toast.error(res.userMessage ?? strings.somethingWentWrong);
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-sage-500" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a test" className="w-64" />
        </div>
        <Button onClick={() => setForm(emptyDraft())}>
          <Plus className="h-4 w-4" />
          Add test
        </Button>
      </div>

      {tests.length === 0 ? (
        <EmptyState
          icon={Beaker}
          message="No tests yet. Add the departments and sample types under Settings → Laboratory first, then add each test here."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Test</TH>
              <TH>Section</TH>
              <TH>Sample</TH>
              <TH>Result</TH>
              <TH numeric>Price</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <tbody>
            {shown.map((t) => (
              <TR key={t.id}>
                <TD>
                  <div className="font-medium text-sage-900">{t.name}</div>
                  {t.shortCode && <div className="text-[12px] text-sage-500">{t.shortCode}</div>}
                </TD>
                <TD>{t.departmentName || "—"}</TD>
                <TD>{t.sampleTypeName || "—"}</TD>
                <TD className="text-[13px]">
                  {t.resultType === "multi" ? `${t.parameters.length} values` : TYPE_LABEL[t.resultType]}
                </TD>
                <TD numeric>{formatPaisa(t.ratePaisa)}</TD>
                <TD>
                  {!t.active ? (
                    <Badge tone="danger">Off</Badge>
                  ) : t.billable ? (
                    <Badge tone="ok">Billed</Badge>
                  ) : (
                    <Badge tone="neutral">In profiles only</Badge>
                  )}
                </TD>
                <TD className="text-right">
                  <Button variant="ghost" onClick={() => setForm(toDraft(t))}>
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
        title={form?.id ? `Edit ${form.name}` : "Add test"}
        className="max-w-4xl"
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
          <div className="flex max-h-[72vh] flex-col gap-4 overflow-y-auto pr-1">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Field label="Name">
                  <Input value={form.name} onChange={(e) => set({ name: e.target.value })} />
                </Field>
              </div>
              <Field label="Short code" hint="For searching at the counter">
                <Input value={form.shortCode} onChange={(e) => set({ shortCode: e.target.value })} />
              </Field>
              <Field label="Section">
                <Select value={form.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Sample" hint="Blank if nothing is drawn">
                <Select value={form.sampleTypeId} onChange={(e) => set({ sampleTypeId: e.target.value })}>
                  <option value="">—</option>
                  {sampleTypes.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Price (Rs)">
                <Input value={form.rate} inputMode="decimal" onChange={(e) => set({ rate: e.target.value })} />
              </Field>
              <Field label="Method" hint="Printed on the report">
                <Input value={form.method} onChange={(e) => set({ method: e.target.value })} />
              </Field>
              <Field label="Ready in (hours)">
                <Input value={form.tatHours} inputMode="numeric" onChange={(e) => set({ tatHours: e.target.value })} />
              </Field>
              <Field label="Order on the report">
                <Input value={form.sortOrder} inputMode="numeric" onChange={(e) => set({ sortOrder: e.target.value })} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-4 text-[14px]">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /> In use
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.billable} onChange={(e) => set({ billable: e.target.checked })} /> Can be billed on
                its own
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.vatApplicable} onChange={(e) => set({ vatApplicable: e.target.checked })} /> VAT
                applies
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="The result is">
                <Select value={form.resultType} onChange={(e) => set({ resultType: e.target.value as LabResultType })}>
                  {(Object.keys(TYPE_LABEL) as LabResultType[]).map((k) => (
                    <option key={k} value={k}>
                      {TYPE_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              {form.resultType !== "multi" && (
                <Field label="Unit">
                  <Input value={form.unit} onChange={(e) => set({ unit: e.target.value })} />
                </Field>
              )}
              {form.resultType === "select" && (
                <Field label="Choices" hint="Separated by commas">
                  <Input value={form.options} onChange={(e) => set({ options: e.target.value })} />
                </Field>
              )}
            </div>

            {form.resultType !== "multi" && (
              <fieldset className="rounded-[8px] border border-line p-3">
                <legend className="px-1 text-[13px] font-semibold text-sage-700">Reference range</legend>
                <RangeEditor value={form.range} numeric={form.resultType === "numeric"} onChange={(range) => set({ range })} />
              </fieldset>
            )}

            {form.resultType === "multi" && (
              <fieldset className="rounded-[8px] border border-line p-3">
                <legend className="px-1 text-[13px] font-semibold text-sage-700">Values in this test</legend>
                <div className="flex flex-col gap-3">
                  {form.parameters.map((p, i) => (
                    <div key={p.id ?? `new-${i}`} className="rounded-[8px] border border-line bg-cream-50 p-3">
                      <div className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1.4fr_auto]">
                        <Field label="Name">
                          <Input value={p.name} onChange={(e) => setP(i, { name: e.target.value })} />
                        </Field>
                        <Field label="Unit">
                          <Input value={p.unit} onChange={(e) => setP(i, { unit: e.target.value })} />
                        </Field>
                        <Field label="The result is">
                          <Select value={p.resultType} onChange={(e) => setP(i, { resultType: e.target.value as LabParamType })}>
                            {(["numeric", "text", "select", "pos_neg"] as LabParamType[]).map((k) => (
                              <option key={k} value={k}>
                                {TYPE_LABEL[k]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <div className="flex gap-1">
                          <Button variant="ghost" title="Move up" onClick={() => moveP(i, -1)}>
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" title="Move down" onClick={() => moveP(i, 1)}>
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            title="Remove"
                            onClick={() => set({ parameters: form.parameters.filter((_, j) => j !== i) })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {p.resultType === "select" && (
                        <div className="mt-2">
                          <Field label="Choices" hint="Separated by commas">
                            <Input value={p.options} onChange={(e) => setP(i, { options: e.target.value })} />
                          </Field>
                        </div>
                      )}
                      <div className="mt-2">
                        <RangeEditor value={p.range} numeric={p.resultType === "numeric"} onChange={(range) => setP(i, { range })} />
                      </div>
                    </div>
                  ))}
                  <Button
                    variant="secondary"
                    onClick={() =>
                      set({
                        parameters: [
                          ...form.parameters,
                          { name: "", unit: "", resultType: "numeric", options: "", defaultRemarks: "", range: EMPTY_RANGE },
                        ],
                      })
                    }
                  >
                    <Plus className="h-4 w-4" />
                    Add a value
                  </Button>
                </div>
              </fieldset>
            )}

            <Field label="Note printed under this test" hint="Optional">
              <Input value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
          </div>
        )}
      </Dialog>
    </div>
  );
}
