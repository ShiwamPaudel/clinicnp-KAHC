"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { saveTestAction } from "@/app/(app)/lab/actions";
import { paisaToRupees, toPaisa } from "@/lib/money";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/cn";
import { RangeEditor, rangeToDraft, draftToRange, rangeSummary, EMPTY_RANGE, type RangeDraft } from "@/components/lab/range-editor";
import type { LabTest, LabResultType, LabParamType } from "@/lib/repos/lab-catalog";

interface Option {
  id: string;
  name: string;
}

interface ParamDraft {
  key: string;
  id?: string;
  name: string;
  unit: string;
  resultType: LabParamType;
  options: string[];
  defaultRemarks: string;
  range: RangeDraft;
  open: boolean;
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
  options: string[];
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
  multi: "Several values",
  none: "None",
};
const PARAM_TYPES: LabParamType[] = ["numeric", "text", "select", "pos_neg"];

let seq = 0;
const newKey = () => `p${++seq}`;

const blankParam = (): ParamDraft => ({
  key: newKey(),
  name: "",
  unit: "",
  resultType: "numeric",
  options: [],
  defaultRemarks: "",
  range: EMPTY_RANGE,
  open: false,
});

function toDraft(t: LabTest | null): TestDraft {
  if (!t) {
    return {
      name: "",
      shortCode: "",
      departmentId: "",
      sampleTypeId: "",
      method: "",
      description: "",
      resultType: "numeric",
      unit: "",
      options: [],
      defaultRemarks: "",
      tatHours: "",
      sortOrder: "0",
      active: true,
      billable: true,
      rate: "",
      vatApplicable: false,
      range: EMPTY_RANGE,
      parameters: [],
    };
  }
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
    options: t.selectOptions,
    defaultRemarks: t.defaultRemarks,
    tatHours: t.tatHours == null ? "" : String(t.tatHours),
    sortOrder: String(t.sortOrder),
    active: t.active,
    billable: t.billable,
    rate: t.ratePaisa ? String(paisaToRupees(t.ratePaisa)) : "",
    vatApplicable: t.vatApplicable,
    range: rangeToDraft(t),
    parameters: t.parameters.map((p) => ({
      key: newKey(),
      id: p.id,
      name: p.name,
      unit: p.unit,
      resultType: p.resultType,
      options: p.selectOptions,
      defaultRemarks: p.defaultRemarks,
      range: rangeToDraft(p),
      open: false,
    })),
  };
}

/** One card of the form: a heading and its fields. */
function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[10px] border border-line bg-cream-50">
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-[15px] font-semibold text-sage-900">{title}</h2>
        {aside}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/** A tick box with its words beside it, the same everywhere on the form. */
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-sage-900">
      <input type="checkbox" className="h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** The answers to pick from: type one and press Enter. */
function ChoicesInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !value.includes(s));
    if (parts.length) onChange([...value, ...parts]);
    setText("");
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-[8px] border border-line bg-cream-50 px-2 py-1.5 focus-within:ring-2 focus-within:ring-sage-700">
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-[6px] bg-sage-75 px-2 py-0.5 text-[13px] text-sage-900">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>
            <X className="h-3 w-3 text-sage-600" />
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={add}
        placeholder={value.length ? "" : "Type a choice, press Enter"}
        className="min-w-[140px] flex-1 bg-transparent px-1 text-[14px] outline-none placeholder:text-sage-300"
      />
    </div>
  );
}

/** The kind of answer, as a row of buttons rather than a hidden drop-down. */
function TypePicker({ value, onChange }: { value: LabResultType; onChange: (v: LabResultType) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="The result is">
      {(Object.keys(TYPE_LABEL) as LabResultType[]).map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          onClick={() => onChange(k)}
          className={cn(
            "h-9 rounded-[8px] border px-3 text-[13px] font-medium",
            value === k
              ? "border-sage-700 bg-sage-700 text-cream-50"
              : "border-line bg-cream-50 text-sage-700 hover:bg-cream-200",
          )}
        >
          {TYPE_LABEL[k]}
        </button>
      ))}
    </div>
  );
}

/**
 * Lab → Tests → one test, on its own page. Grouped the way the lab thinks
 * about a test: what it is, what its answer looks like, what it costs, and
 * what prints under it. Reference ranges are the lab in-charge's to enter.
 */
export function TestEditor({
  test,
  departments,
  sampleTypes,
  profileNames,
}: {
  test: LabTest | null;
  departments: Option[];
  sampleTypes: Option[];
  profileNames: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<TestDraft>(() => toDraft(test));
  const [pending, start] = useTransition();

  const set = (patch: Partial<TestDraft>) => setForm((f) => ({ ...f, ...patch }));
  const setP = (key: string, patch: Partial<ParamDraft>) =>
    setForm((f) => ({ ...f, parameters: f.parameters.map((p) => (p.key === key ? { ...p, ...patch } : p)) }));
  const moveP = (i: number, by: number) =>
    setForm((f) => {
      const list = [...f.parameters];
      const j = i + by;
      if (j < 0 || j >= list.length) return f;
      [list[i], list[j]] = [list[j]!, list[i]!];
      return { ...f, parameters: list };
    });

  function save() {
    let payload;
    try {
      const rateText = form.rate.replace(/,/g, "").trim();
      const rateNum = rateText === "" ? 0 : Number(rateText);
      if (!Number.isFinite(rateNum) || rateNum < 0) throw new Error("The price has to be a number.");
      const tat = form.tatHours.trim();
      if (tat && !/^\d+$/.test(tat)) throw new Error("Ready in has to be a whole number of hours.");
      payload = {
        id: form.id,
        name: form.name,
        shortCode: form.shortCode,
        departmentId: form.departmentId || null,
        sampleTypeId: form.sampleTypeId || null,
        method: form.method,
        description: form.description,
        resultType: form.resultType,
        unit: form.resultType === "multi" || form.resultType === "none" ? "" : form.unit,
        selectOptions: form.resultType === "select" ? form.options : [],
        defaultRemarks: form.defaultRemarks,
        tatHours: tat ? Number(tat) : null,
        sortOrder: Math.max(0, Math.trunc(Number(form.sortOrder || "0")) || 0),
        active: form.active,
        billable: form.billable,
        ratePaisa: toPaisa(rateNum),
        vatApplicable: form.vatApplicable,
        ...(form.resultType === "multi" || form.resultType === "none" ? draftToRange(EMPTY_RANGE) : draftToRange(form.range)),
        parameters:
          form.resultType === "multi"
            ? form.parameters.map((p) => ({
                id: p.id,
                name: p.name,
                unit: p.unit,
                resultType: p.resultType,
                selectOptions: p.resultType === "select" ? p.options : [],
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
      if (!res.ok) {
        toast.error(res.userMessage ?? strings.somethingWentWrong);
        return;
      }
      toast.success(strings.saved);
      router.push("/lab/tests");
      router.refresh();
    });
  }

  const single = form.resultType !== "multi" && form.resultType !== "none";

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5 pb-4">
      <div>
        <Link href="/lab/tests" className="inline-flex items-center gap-1 text-[13px] text-sage-600 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" />
          Tests
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[22px] font-bold text-sage-950">{test ? test.name : "New test"}</h1>
          {test && !test.active && <Badge tone="danger">Off</Badge>}
        </div>
      </div>

      <Section title="Test">
        <div className="grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-4">
            <Field label="Name">
              <Input value={form.name} autoFocus={!test} onChange={(e) => set({ name: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Short code">
              <Input value={form.shortCode} placeholder="For quick search" onChange={(e) => set({ shortCode: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Department">
              <Select value={form.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
                <option value="">-</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Sample">
              <Select value={form.sampleTypeId} onChange={(e) => set({ sampleTypeId: e.target.value })}>
                <option value="">Nothing to collect</option>
                {sampleTypes.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Ready in (hours)">
              <Input value={form.tatHours} numeric inputMode="numeric" onChange={(e) => set({ tatHours: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-4">
            <Field label="Method">
              <Input value={form.method} placeholder="Printed on the report" onChange={(e) => set({ method: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Order on the report">
              <Input value={form.sortOrder} numeric inputMode="numeric" onChange={(e) => set({ sortOrder: e.target.value })} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Result">
        <div className="flex flex-col gap-5">
          <TypePicker value={form.resultType} onChange={(resultType) => set({ resultType })} />
          {form.resultType === "none" && (
            <p className="text-[13px] text-sage-600">
              Billed only. It does not go to Sample collection, Result entry or the report.
              {test && test.resultType !== "none" && " Saving takes it off Result entry on bills already made."}
            </p>
          )}

          {single && (
            <div className="grid gap-4 sm:grid-cols-6">
              {form.resultType !== "pos_neg" && (
                <div className="sm:col-span-2">
                  <Field label="Unit">
                    <Input value={form.unit} placeholder="mg/dL" onChange={(e) => set({ unit: e.target.value })} />
                  </Field>
                </div>
              )}
              {form.resultType === "select" && (
                <div className="sm:col-span-4">
                  <Field label="Choices">
                    <ChoicesInput value={form.options} onChange={(options) => set({ options })} />
                  </Field>
                </div>
              )}
            </div>
          )}

          {single && (
            <div className="rounded-[8px] border border-line bg-cream-100/60 p-4">
              <div className="mb-3 text-[13px] font-semibold text-sage-700">Reference range</div>
              <RangeEditor value={form.range} numeric={form.resultType === "numeric"} onChange={(range) => set({ range })} />
            </div>
          )}

          {form.resultType === "multi" && (
            <div className="flex flex-col gap-2">
              {form.parameters.length > 0 && (
                <div className="hidden grid-cols-[minmax(0,1.6fr)_120px_180px_minmax(0,1.4fr)_112px] gap-3 px-3 text-[12px] font-medium text-sage-600 sm:grid">
                  <span>Value</span>
                  <span>Unit</span>
                  <span>The result is</span>
                  <span>Choices</span>
                  <span />
                </div>
              )}
              {form.parameters.map((p, i) => (
                <div key={p.key} className="rounded-[8px] border border-line bg-white">
                  <div className="grid items-start gap-3 p-3 sm:grid-cols-[minmax(0,1.6fr)_120px_180px_minmax(0,1.4fr)_112px]">
                    <Input value={p.name} placeholder="Neutrophils" aria-label="Value name" onChange={(e) => setP(p.key, { name: e.target.value })} />
                    <Input value={p.unit} placeholder="%" aria-label="Unit" onChange={(e) => setP(p.key, { unit: e.target.value })} />
                    <Select value={p.resultType} aria-label="The result is" onChange={(e) => setP(p.key, { resultType: e.target.value as LabParamType })}>
                      {PARAM_TYPES.map((k) => (
                        <option key={k} value={k}>
                          {TYPE_LABEL[k]}
                        </option>
                      ))}
                    </Select>
                    {p.resultType === "select" ? (
                      <ChoicesInput value={p.options} onChange={(options) => setP(p.key, { options })} />
                    ) : (
                      <span className="hidden h-10 items-center text-[13px] text-sage-300 sm:flex">-</span>
                    )}
                    <div className="flex justify-end gap-0.5">
                      <Button variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => moveP(i, -1)}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" aria-label="Move down" disabled={i === form.parameters.length - 1} onClick={() => moveP(i, 1)}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label="Remove"
                        onClick={() => set({ parameters: form.parameters.filter((x) => x.key !== p.key) })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="border-t border-line px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setP(p.key, { open: !p.open })}
                      className="flex items-center gap-1.5 text-[13px] text-sage-700 hover:text-sage-900"
                    >
                      {p.open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      Reference range
                      <span className="text-sage-500">{rangeSummary(p.range) ? `· ${rangeSummary(p.range)}` : "· not set"}</span>
                    </button>
                    {p.open && (
                      <div className="mt-3 pb-1">
                        <RangeEditor value={p.range} numeric={p.resultType === "numeric"} onChange={(range) => setP(p.key, { range })} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <Button
                variant="secondary"
                className="w-fit"
                onClick={() => set({ parameters: [...form.parameters, blankParam()] })}
              >
                <Plus className="h-4 w-4" />
                Add a value
              </Button>
            </div>
          )}
        </div>
      </Section>

      <Section title="Billing">
        <div className="grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <Field label="Price (Rs)">
              <Input value={form.rate} numeric inputMode="decimal" placeholder="Not set" onChange={(e) => set({ rate: e.target.value })} />
            </Field>
          </div>
          <div className="flex flex-col justify-end gap-2.5 pb-2 sm:col-span-4">
            <div className="flex flex-wrap gap-x-6 gap-y-2.5">
              <Toggle checked={form.billable} onChange={(billable) => set({ billable })} label="Billed on its own" />
              <Toggle checked={form.vatApplicable} onChange={(vatApplicable) => set({ vatApplicable })} label="VAT applies" />
              <Toggle checked={form.active} onChange={(active) => set({ active })} label="In use" />
            </div>
          </div>
        </div>
        {profileNames.length > 0 && (
          <p className="mt-4 text-[13px] text-sage-600">
            Part of: <span className="text-sage-900">{profileNames.join(", ")}</span>
          </p>
        )}
      </Section>

      <Section title="On the report">
        <div className="grid gap-4">
          <Field label="Note on the report">
            <textarea
              value={form.description}
              rows={3}
              onChange={(e) => set({ description: e.target.value })}
              className="w-full rounded-[8px] border border-line bg-cream-50 px-3 py-2 text-[14px] text-sage-950 placeholder:text-sage-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sage-700"
            />
          </Field>
          {single && (
            <Field label="Usual remark">
              <Input value={form.defaultRemarks} onChange={(e) => set({ defaultRemarks: e.target.value })} />
            </Field>
          )}
        </div>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-6 flex justify-end gap-2 border-t border-line bg-cream-100/95 px-6 py-3 backdrop-blur">
        <Link href="/lab/tests">
          <Button variant="secondary">{strings.cancel}</Button>
        </Link>
        <Button onClick={save} disabled={pending || !form.name.trim()}>
          {pending ? "Saving…" : strings.save}
        </Button>
      </div>
    </div>
  );
}
