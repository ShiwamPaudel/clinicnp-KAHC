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

/** "4 – 11", "Up to 200", or "" — a one-line reading of a range, for summaries. */
export function rangeSummary(d: RangeDraft): string {
  const lo = d.refLow.trim();
  const hi = d.refHigh.trim();
  let main = "";
  if (lo && hi) main = `${lo} – ${hi}`;
  else if (lo) main = `${lo} and above`;
  else if (hi) main = `Up to ${hi}`;
  if (d.refText.trim()) main = d.refText.trim();
  const extra = d.overrides.length ? ` · ${d.overrides.length} by sex or age` : "";
  return main ? main + extra : extra.replace(/^ · /, "");
}

/**
 * The reference range for one value, with optional narrower ranges by sex and
 * age. Fixed columns, so every row lines up with the one above it.
 */
export function RangeEditor({ value, onChange, numeric }: { value: RangeDraft; onChange: (r: RangeDraft) => void; numeric: boolean }) {
  const set = (patch: Partial<RangeDraft>) => onChange({ ...value, ...patch });
  const setO = (i: number, patch: Partial<OverrideDraft>) =>
    set({ overrides: value.overrides.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  return (
    <div className="flex flex-col gap-3">
      {numeric ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.6fr)]">
          <Field label="Low">
            <Input value={value.refLow} numeric inputMode="decimal" onChange={(e) => set({ refLow: e.target.value })} />
          </Field>
          <Field label="High">
            <Input value={value.refHigh} numeric inputMode="decimal" onChange={(e) => set({ refHigh: e.target.value })} />
          </Field>
          <Field label="Critical low">
            <Input value={value.criticalLow} numeric inputMode="decimal" onChange={(e) => set({ criticalLow: e.target.value })} />
          </Field>
          <Field label="Critical high">
            <Input value={value.criticalHigh} numeric inputMode="decimal" onChange={(e) => set({ criticalHigh: e.target.value })} />
          </Field>
          <div className="col-span-2 sm:col-span-1">
            <Field label="Print as (optional)">
              <Input value={value.refText} placeholder="Up to 200" onChange={(e) => set({ refText: e.target.value })} />
            </Field>
          </div>
        </div>
      ) : (
        <Field label="Reference, as printed">
          <Input value={value.refText} placeholder="Negative" onChange={(e) => set({ refText: e.target.value })} />
        </Field>
      )}

      {value.overrides.length > 0 && (
        <div className="overflow-x-auto rounded-[8px] border border-line bg-white">
          <table className="w-full min-w-[620px] text-[13px]">
            <thead className="bg-cream-100 text-left text-[12px] text-sage-600">
              <tr>
                <th className="px-2 py-1.5 font-medium">For</th>
                <th className="px-2 py-1.5 font-medium">From age (yrs)</th>
                <th className="px-2 py-1.5 font-medium">Under age (yrs)</th>
                {numeric && <th className="px-2 py-1.5 font-medium">Low</th>}
                {numeric && <th className="px-2 py-1.5 font-medium">High</th>}
                <th className="px-2 py-1.5 font-medium">Print as</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {value.overrides.map((o, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-2 py-1.5">
                    <Select value={o.sex} onChange={(e) => setO(i, { sex: e.target.value as OverrideDraft["sex"] })}>
                      <option value="">Anyone</option>
                      <option value="m">Male</option>
                      <option value="f">Female</option>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5">
                    <Input value={o.minAge} numeric inputMode="numeric" onChange={(e) => setO(i, { minAge: e.target.value })} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input value={o.maxAge} numeric inputMode="numeric" onChange={(e) => setO(i, { maxAge: e.target.value })} />
                  </td>
                  {numeric && (
                    <td className="px-2 py-1.5">
                      <Input value={o.low} numeric inputMode="decimal" onChange={(e) => setO(i, { low: e.target.value })} />
                    </td>
                  )}
                  {numeric && (
                    <td className="px-2 py-1.5">
                      <Input value={o.high} numeric inputMode="decimal" onChange={(e) => setO(i, { high: e.target.value })} />
                    </td>
                  )}
                  <td className="px-2 py-1.5">
                    <Input value={o.text} onChange={(e) => setO(i, { text: e.target.value })} />
                  </td>
                  <td className="px-1 py-1.5 text-right">
                    <Button
                      variant="ghost"
                      aria-label="Remove this range"
                      onClick={() => set({ overrides: value.overrides.filter((_, j) => j !== i) })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        className="flex w-fit items-center gap-1 text-[13px] font-medium text-clinic-700 hover:underline"
        onClick={() => set({ overrides: [...value.overrides, { sex: "", minAge: "", maxAge: "", low: "", high: "", text: "" }] })}
      >
        <Plus className="h-3.5 w-3.5" />
        Different range by sex or age
      </button>
    </div>
  );
}
