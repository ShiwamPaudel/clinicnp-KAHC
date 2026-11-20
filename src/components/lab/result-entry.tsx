"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Send, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { saveResultsAction } from "@/app/(app)/lab/actions";
import { computeFlag, flagSymbol, numericValue, type ResultFlag } from "@/lib/lab-flags";
import { RESULT_STATUS_LABEL, resultTone } from "@/lib/lab-format";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/cn";
import type { OrderResult } from "@/lib/repos/lab-orders";

type Draft = Record<string, { remarks: string; values: Record<string, { value: string; remarks: string }> }>;

const keyOf = (parameterId: string | null) => parameterId ?? "_";

function initialDraft(results: OrderResult[]): Draft {
  const d: Draft = {};
  for (const r of results) {
    const values: Draft[string]["values"] = {};
    for (const f of r.fields) {
      const saved = r.values.find((v) => (v.parameterId ?? null) === f.parameterId);
      values[keyOf(f.parameterId)] = { value: saved?.valueText ?? "", remarks: saved?.remarks ?? f.defaultRemarks };
    }
    d[r.id] = { remarks: r.technicianRemarks, values };
  }
  return d;
}

const FLAG_TONE: Record<ResultFlag, string> = {
  normal: "",
  low: "text-info-600",
  high: "text-danger-600",
  critical_low: "font-bold text-danger-600",
  critical_high: "font-bold text-danger-600",
  abnormal: "text-danger-600",
};

/**
 * Result entry for one order. The flag beside a number is a preview; the
 * server works it out again against the same range when it saves.
 */
export function ResultEntry({ orderId, results }: { orderId: string; results: OrderResult[] }) {
  const router = useRouter();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(results));
  const [pending, start] = useTransition();

  const editable = useMemo(
    () => results.filter((r) => r.status !== "approved" && r.status !== "dispatched"),
    [results],
  );

  function setValue(resultId: string, key: string, patch: Partial<{ value: string; remarks: string }>) {
    setDraft((d) => {
      const r = d[resultId]!;
      return { ...d, [resultId]: { ...r, values: { ...r.values, [key]: { ...r.values[key]!, ...patch } } } };
    });
  }

  function save(mode: "draft" | "submit") {
    const entries = editable
      .filter((r) => !r.sampleStatus || r.sampleStatus === "collected")
      .map((r) => ({
        resultId: r.id,
        technicianRemarks: draft[r.id]?.remarks ?? "",
        values: r.fields.map((f) => ({
          parameterId: f.parameterId,
          value: draft[r.id]?.values[keyOf(f.parameterId)]?.value ?? "",
          remarks: draft[r.id]?.values[keyOf(f.parameterId)]?.remarks ?? "",
        })),
      }));
    start(async () => {
      const res = await saveResultsAction({ orderId, mode, entries });
      if (!res.ok) {
        toast.error(res.userMessage ?? strings.somethingWentWrong);
        return;
      }
      if (mode === "draft") toast.success("Saved as a draft");
      else if ((res.drafted ?? 0) > 0)
        toast.success(`${res.submitted} sent for approval · ${res.drafted} kept as draft`);
      else toast.success("Sent for approval");
      router.refresh();
      if (mode === "submit" && (res.drafted ?? 0) === 0) router.push("/lab/results");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {results.map((r) => {
        const locked = r.status === "approved" || r.status === "dispatched";
        const noSample = Boolean(r.sampleStatus && r.sampleStatus !== "collected");
        return (
          <section key={r.id} className="rounded-[10px] border border-line bg-cream-50">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <div>
                <span className="text-[15px] font-semibold text-sage-900">{r.testName}</span>
                {r.groupName && <span className="ml-2 text-[12px] text-sage-500">{r.groupName}</span>}
                {r.departmentName && <span className="ml-2 text-[12px] text-sage-500">· {r.departmentName}</span>}
              </div>
              <Badge tone={resultTone(r.status)}>{RESULT_STATUS_LABEL[r.status] ?? r.status}</Badge>
            </header>
            {r.correctionNote && !locked && (
              <div className="flex items-start gap-2 border-b border-line bg-danger-100/50 px-4 py-2 text-[13px] text-danger-600">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Sent back: {r.correctionNote}
              </div>
            )}
            {noSample ? (
              <p className="px-4 py-3 text-[13px] text-sage-500">The sample for this test has not been collected yet.</p>
            ) : (
              <table className="w-full text-[14px]">
                <thead className="text-[12px] text-sage-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Test</th>
                    <th className="px-2 py-2 text-left font-medium">Result</th>
                    <th className="px-2 py-2 text-left font-medium">Unit</th>
                    <th className="px-2 py-2 text-left font-medium">Reference range</th>
                    <th className="px-4 py-2 text-left font-medium">Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {r.fields.map((f) => {
                    const key = keyOf(f.parameterId);
                    const v = draft[r.id]?.values[key] ?? { value: "", remarks: "" };
                    const num = f.resultType === "numeric" ? numericValue(v.value) : null;
                    const flag = num == null ? "normal" : computeFlag(num, f);
                    return (
                      <tr key={key} className="border-t border-line">
                        <td className="px-4 py-2 text-sage-900">{f.label}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            {f.resultType === "select" || f.resultType === "pos_neg" ? (
                              <Select
                                value={v.value}
                                disabled={locked || pending}
                                onChange={(e) => setValue(r.id, key, { value: e.target.value })}
                                className="w-44"
                              >
                                <option value="">—</option>
                                {f.options.map((o) => (
                                  <option key={o} value={o}>
                                    {o}
                                  </option>
                                ))}
                              </Select>
                            ) : (
                              <Input
                                value={v.value}
                                disabled={locked || pending}
                                inputMode={f.resultType === "numeric" ? "decimal" : undefined}
                                onChange={(e) => setValue(r.id, key, { value: e.target.value })}
                                className={cn(f.resultType === "numeric" ? "w-32" : "w-64", FLAG_TONE[flag])}
                              />
                            )}
                            {flag !== "normal" && (
                              <span className={cn("text-[13px]", FLAG_TONE[flag])}>{flagSymbol(flag)}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-sage-600">{f.unit}</td>
                        <td className="px-2 py-2 text-sage-600">{f.refText || "—"}</td>
                        <td className="px-4 py-2">
                          <Input
                            value={v.remarks}
                            disabled={locked || pending}
                            onChange={(e) => setValue(r.id, key, { remarks: e.target.value })}
                            className="w-48"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {!noSample && (
              <div className="border-t border-line px-4 py-2">
                <Input
                  value={draft[r.id]?.remarks ?? ""}
                  disabled={locked || pending}
                  placeholder="Note on this test (printed on the report)"
                  onChange={(e) => setDraft((d) => ({ ...d, [r.id]: { ...d[r.id]!, remarks: e.target.value } }))}
                />
              </div>
            )}
          </section>
        );
      })}

      {editable.length > 0 && (
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-cream-100/95 py-3">
          <Button variant="secondary" disabled={pending} onClick={() => save("draft")}>
            <Save className="h-4 w-4" />
            Save draft
          </Button>
          <Button disabled={pending} onClick={() => save("submit")}>
            <Send className="h-4 w-4" />
            Send for approval
          </Button>
        </div>
      )}
    </div>
  );
}
