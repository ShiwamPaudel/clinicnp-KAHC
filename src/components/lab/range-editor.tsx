"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input, Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { RangeOverride } from "@/lib/lab-flags";

/** Range fields as the form holds them: text boxes, so an empty one means "not set". */
export interface RangeDraft {
  refText: string;
  refLow: string;
  refHigh: string;
  criticalLow: string;
  criticalHigh: string;
  overrides: OverrideDraft[];
}

export interface OverrideDraft {
  sex: "" | "m" | "f";
  minAge: string;
  maxAge: string;
  low: string;
  high: string;
  text: string;
}

const toStr = (n: number | null | undefined) => (n == null ? "" : String(n));

export function rangeToDraft(r: {
  refText: string;
  refLow: number | null;
  refHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  overrides: RangeOverride[];
}): RangeDraft {
  return {
    refText: r.refText,
    refLow: toStr(r.refLow),
    refHigh: toStr(r.refHigh),
    criticalLow: toStr(r.criticalLow),
    criticalHigh: toStr(r.criticalHigh),
    overrides: r.overrides.map((o) => ({
      sex: o.sex ?? "",
      minAge: toStr(o.minAgeYears),
      maxAge: toStr(o.maxAgeYears),
      low: toStr(o.low),
      high: toStr(o.high),
      text: o.text ?? "",
    })),
  };
}

export const EMPTY_RANGE: RangeDraft = { refText: "", refLow: "", refHigh: "", criticalLow: "", criticalHigh: "", overrides: [] };

/** Null for an empty box; a number otherwise. Throws a sentence for nonsense. */
function num(s: string, what: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`${what} has to be a number.`);
  return n;
}

/** The form's range as the server takes it. Throws a plain sentence when a box is not a number. */
export function draftToRange(d: RangeDraft) {
  return {
    refText: d.refText.trim(),
    refLow: num(d.refLow, "The low limit"),
    refHigh: num(d.refHigh, "The high limit"),
    criticalLow: num(d.criticalLow, "The critical low"),
    criticalHigh: num(d.criticalHigh, "The critical high"),
    overrides: d.overrides.map((o) => {
      const minAge = num(o.minAge, "An age");
      const maxAge = num(o.maxAge, "An age");
      return {
        ...(o.sex ? { sex: o.sex } : {}),
        ...(minAge != null ? { minAgeYears: Math.trunc(minAge) } : {}),
        ...(maxAge != null ? { maxAgeYears: Math.trunc(maxAge) } : {}),
        low: num(o.low, "A low limit"),
        high: num(o.high, "A high limit"),
        ...(o.text.trim() ? { text: o.text.trim() } : {}),
      };
    }),
  };
}

/** The reference range for one value, with optional narrower ranges by sex and age. */
export function RangeEditor({ value, onChange, numeric }: { value: RangeDraft; onChange: (r: RangeDraft) => void; numeric: boolean }) {
  const set = (patch: Partial<RangeDraft>) => onChange({ ...value, ...patch });
  const setO = (i: number, patch: Partial<OverrideDraft>) =>
    set({ overrides: value.overrides.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {numeric && (
          <>
            <Field label="Low">
              <Input value={value.refLow} inputMode="decimal" onChange={(e) => set({ refLow: e.target.value })} />
            </Field>
            <Field label="High">
              <Input value={value.refHigh} inputMode="decimal" onChange={(e) => set({ refHigh: e.target.value })} />
            </Field>
            <Field label="Critical low">
              <Input value={value.criticalLow} inputMode="decimal" onChange={(e) => set({ criticalLow: e.target.value })} />
            </Field>
            <Field label="Critical high">
              <Input value={value.criticalHigh} inputMode="decimal" onChange={(e) => set({ criticalHigh: e.target.value })} />
            </Field>
          </>
        )}
        <div className={numeric ? "" : "col-span-2 sm:col-span-5"}>
          <Field label={numeric ? "Or print as" : "Reference (as printed)"}>
            <Input value={value.refText} placeholder={numeric ? "e.g. Up to 200" : "e.g. Negative"} onChange={(e) => set({ refText: e.target.value })} />
          </Field>
        </div>
      </div>
      {value.overrides.map((o, i) => (
        <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-[8px] bg-cream-100 p-2 sm:grid-cols-7">
          <Field label="For">
            <Select value={o.sex} onChange={(e) => setO(i, { sex: e.target.value as OverrideDraft["sex"] })}>
              <option value="">Anyone</option>
              <option value="m">Male</option>
              <option value="f">Female</option>
            </Select>
          </Field>
          <Field label="Age from (years)">
            <Input value={o.minAge} inputMode="numeric" onChange={(e) => setO(i, { minAge: e.target.value })} />
          </Field>
          <Field label="Under (years)">
            <Input value={o.maxAge} inputMode="numeric" onChange={(e) => setO(i, { maxAge: e.target.value })} />
          </Field>
          {numeric && (
            <>
              <Field label="Low">
                <Input value={o.low} inputMode="decimal" onChange={(e) => setO(i, { low: e.target.value })} />
              </Field>
              <Field label="High">
                <Input value={o.high} inputMode="decimal" onChange={(e) => setO(i, { high: e.target.value })} />
              </Field>
            </>
          )}
          <Field label="Print as">
            <Input value={o.text} onChange={(e) => setO(i, { text: e.target.value })} />
          </Field>
          <Button variant="ghost" title="Remove" onClick={() => set({ overrides: value.overrides.filter((_, j) => j !== i) })}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <button
        type="button"
        className="flex w-fit items-center gap-1 text-[13px] text-sage-600 hover:underline"
        onClick={() => set({ overrides: [...value.overrides, { sex: "", minAge: "", maxAge: "", low: "", high: "", text: "" }] })}
      >
        <Plus className="h-3.5 w-3.5" />
        Different range by sex or age
      </button>
    </div>
  );
}
