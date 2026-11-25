"use client";

import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Send, AlertTriangle, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { saveResultsAction } from "@/app/(app)/lab/actions";
import { computeFlag, flagSymbol, numericValue, type ResultFlag } from "@/lib/lab-flags";
import { recalculate, isOtherOption, type CalcField } from "@/lib/lab-formula";
import { noteGroups } from "@/lib/lab-notes";
import { RESULT_STATUS_LABEL, resultTone } from "@/lib/lab-format";
import { strings } from "@/lib/strings";
import { SendOutDialog, BringBackButton, type PartnerOption } from "@/components/lab/send-out";
import { stampAt } from "@/lib/lab-format";
import { cn } from "@/lib/cn";
import type { OrderResult } from "@/lib/repos/lab-orders";

type Draft = Record<string, { remarks: string; values: Record<string, { value: string; remarks: string }> }>;

const keyOf = (parameterId: string | null) => parameterId ?? "_";

/**
 * Enter moves to the next result box, as Tab does, but skips the remark boxes:
 * from the last value of one test it goes to the first value of the next.
 */
function enterToNextResult(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
  e.preventDefault();
  const here = e.currentTarget;
  const next = Array.from(document.querySelectorAll<HTMLElement>("[data-result-field]:not([disabled])")).find(
    (el) => el !== here && Boolean(here.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  if (next) {
    next.focus();
    if (next instanceof HTMLInputElement) next.select();
  }
}

/** A box's id on the order, for the calculation. */
const boxId = (resultId: string, key: string) => `${resultId}:${key}`;

/**
 * A box never saved starts with the test's default result (0035): RA Factor
 * "Negative", urine Colour "Light Yellow". Once saved, what was saved stands,
 * even when it was left empty.
 */
function initialDraft(results: OrderResult[]): Draft {
  const d: Draft = {};
  for (const r of results) {
    const values: Draft[string]["values"] = {};
    for (const f of r.fields) {
      const saved = r.values.find((v) => (v.parameterId ?? null) === f.parameterId);
      values[keyOf(f.parameterId)] = { value: saved ? saved.valueText : f.defaultValue, remarks: saved?.remarks ?? f.defaultRemarks };
    }
    d[r.id] = { remarks: r.technicianRemarks, values };
  }
  return d;
}

/** Every box of the order as the formulas see it. */
function calcFieldsOf(results: OrderResult[]): CalcField[] {
  return results.flatMap((r) =>
    r.fields.map((f) => ({
      id: boxId(r.id, keyOf(f.parameterId)),
      group: r.id,
      code: r.shortCode,
      paramName: f.parameterId == null ? null : f.label,
      formula: f.formula,
      decimals: f.decimals,
    })),
  );
}

function valuesOf(d: Draft): Map<string, string> {
  const m = new Map<string, string>();
  for (const [rid, r] of Object.entries(d)) for (const [k, v] of Object.entries(r.values)) m.set(boxId(rid, k), v.value);
  return m;
}

/** The draft with the calculated boxes filled; boxes in `keep` are left alone. */
function withCalculated(d: Draft, fields: CalcField[], keep: ReadonlySet<string>): Draft {
  const changed = recalculate(fields, valuesOf(d), keep);
  if (changed.size === 0) return d;
  const next: Draft = { ...d };
  for (const [id, text] of changed) {
    const at = id.indexOf(":");
    const rid = id.slice(0, at);
    const key = id.slice(at + 1);
    const r = next[rid];
    if (!r || !r.values[key]) continue;
    next[rid] = { ...r, values: { ...r.values, [key]: { ...r.values[key]!, value: text } } };
  }
  return next;
}

const FLAG_TONE: Record<ResultFlag, string> = {
  normal: "",
  low: "text-info-600",
  high: "text-danger-600",
  critical_low: "font-bold text-danger-600",
  critical_high: "font-bold text-danger-600",
  abnormal: "text-danger-600",
};

export interface SentOutInfo {
  id: string;
  resultId: string;
  partnerName: string;
  sentAt: string;
  sentByName: string;
}

const LOCKED = ["approved", "dispatched", "sent_out"];
const SENDABLE = ["pending", "draft", "correction_required"];

/**
 * Result entry for one order. Each test is either done here or sent to
 * another laboratory, test by test — one bill can have both. The flag beside a
 * number is a preview; the server works it out again when it saves.
 */
export function ResultEntry({
  orderId,
  results,
  partners,
  sentOut,
  canAddPartner,
}: {
  orderId: string;
  results: OrderResult[];
  partners: PartnerOption[];
  sentOut: SentOutInfo[];
  canAddPartner: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const calcFields = useMemo(() => calcFieldsOf(results), [results]);
  // boxes the formulas must not change: locked results, and calculated boxes
  // typed over by hand (emptying one hands it back to its formula)
  const lockedBoxes = useMemo(
    () => new Set(results.filter((r) => LOCKED.includes(r.status)).flatMap((r) => r.fields.map((f) => boxId(r.id, keyOf(f.parameterId))))),
    [results],
  );
  const typedOver = useRef<Set<string> | null>(null);
  const [draft, setDraft] = useState<Draft>(() => {
    const first = initialDraft(results);
    // a saved calculated value that is not what its formula gives was typed by hand
    const expected = recalculate(calcFields, valuesOf(first), lockedBoxes);
    const saved = valuesOf(first);
    typedOver.current = new Set(
      [...expected.keys()].filter((id) => (saved.get(id) ?? "").trim() !== "" && expected.get(id) !== saved.get(id)),
    );
    return withCalculated(first, calcFields, new Set([...lockedBoxes, ...typedOver.current]));
  });
  // a choice list's "Other" picked with nothing typed yet
  const [otherOpen, setOtherOpen] = useState<Set<string>>(() => new Set());
  const [pending, start] = useTransition();
  const [sendDialog, setSendDialog] = useState<{ key: number; initial: string[] } | null>(null);

  const editable = useMemo(() => results.filter((r) => !LOCKED.includes(r.status)), [results]);
  const groups = useMemo(() => noteGroups(results), [results]);
  const sendable = useMemo(
    () => results.filter((r) => SENDABLE.includes(r.status) && (!r.sampleStatus || r.sampleStatus === "collected")),
    [results],
  );
  const sentByResult = useMemo(() => new Map(sentOut.map((s) => [s.resultId, s])), [sentOut]);
  const openSend = (initial: string[]) => setSendDialog({ key: Date.now(), initial });

  function setValue(resultId: string, key: string, patch: Partial<{ value: string; remarks: string }>) {
    const id = boxId(resultId, key);
    const kept = typedOver.current ?? new Set<string>();
    if (patch.value !== undefined && calcFields.some((f) => f.id === id && f.formula.trim())) {
      if (patch.value.trim() === "") kept.delete(id);
      else kept.add(id);
    }
    typedOver.current = kept;
    setDraft((d) => {
      const r = d[resultId]!;
      const next = { ...d, [resultId]: { ...r, values: { ...r.values, [key]: { ...r.values[key]!, ...patch } } } };
      return patch.value === undefined ? next : withCalculated(next, calcFields, new Set([...lockedBoxes, ...kept]));
    });
  }

  function chooseOption(resultId: string, key: string, option: string) {
    const id = boxId(resultId, key);
    setOtherOpen((s) => {
      const n = new Set(s);
      if (isOtherOption(option)) n.add(id);
      else n.delete(id);
      return n;
    });
    setValue(resultId, key, { value: isOtherOption(option) ? "" : option });
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
      {sendable.length > 0 && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => openSend([])}>
            <ArrowUpRight className="h-4 w-4" />
            Send tests to another lab
          </Button>
        </div>
      )}
      {groups.map((g) => (
        <Fragment key={g.key}>
      {g.results.map((r) => {
        const locked = LOCKED.includes(r.status);
        const noSample = Boolean(r.sampleStatus && r.sampleStatus !== "collected");
        const sent = r.status === "sent_out" ? sentByResult.get(r.id) : undefined;
        const canSend = SENDABLE.includes(r.status) && !noSample;
        return (
          <section key={r.id} className="rounded-[10px] border border-line bg-cream-50">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <div>
                <span className="text-[15px] font-semibold text-sage-900">{r.testName}</span>
                {r.groupName && <span className="ml-2 text-[12px] text-sage-500">{r.groupName}</span>}
                {r.departmentName && <span className="ml-2 text-[12px] text-sage-500">· {r.departmentName}</span>}
              </div>
              <div className="flex items-center gap-2">
                {canSend && (
                  <Button variant="ghost" disabled={pending} onClick={() => openSend([r.id])}>
                    <ArrowUpRight className="h-4 w-4" />
                    Send to another lab
                  </Button>
                )}
                <Badge tone={resultTone(r.status)}>{RESULT_STATUS_LABEL[r.status] ?? r.status}</Badge>
              </div>
            </header>
            {r.status === "sent_out" ? (
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[14px]">
                <span className="text-sage-700">
                  {sent ? (
                    <>
                      Sent to <span className="font-semibold text-sage-900">{sent.partnerName}</span>
                      <span className="text-sage-500">
                        {" "}
                        · {sent.sentByName} · {stampAt(sent.sentAt)}
                      </span>
                    </>
                  ) : (
                    "Sent to another lab"
                  )}
                </span>
                {sent && <BringBackButton sendoutId={sent.id} testName={r.testName} />}
              </div>
            ) : (
            <>
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
                    <th className="px-4 py-2 text-left font-medium">Reference range</th>
                  </tr>
                </thead>
                <tbody>
                  {r.fields.map((f) => {
                    const key = keyOf(f.parameterId);
                    const v = draft[r.id]?.values[key] ?? { value: "", remarks: "" };
                    const num = f.resultType === "numeric" ? numericValue(v.value) : null;
                    const flag = num == null ? "normal" : computeFlag(num, f);
                    const id = boxId(r.id, key);
                    const otherChoice = f.options.find(isOtherOption);
                    const listed = f.options.filter((o) => !isOtherOption(o));
                    // a value not in the list was typed under "Other"
                    const inOther = Boolean(otherChoice) && (otherOpen.has(id) || (v.value !== "" && !listed.includes(v.value)));
                    const stray = !otherChoice && v.value !== "" && !f.options.includes(v.value);
                    const calculated = f.resultType === "numeric" && f.formula.trim() !== "";
                    return (
                      <tr key={key} className="border-t border-line">
                        <td className="px-4 py-2 text-sage-900">{f.label}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            {f.resultType === "select" || f.resultType === "pos_neg" ? (
                              <>
                                <Select
                                  data-result-field=""
                                  onKeyDown={enterToNextResult}
                                  value={inOther ? otherChoice! : v.value}
                                  disabled={locked || pending}
                                  onChange={(e) => chooseOption(r.id, key, e.target.value)}
                                  className="w-44"
                                >
                                  <option value="">-</option>
                                  {stray && <option value={v.value}>{v.value}</option>}
                                  {f.options.map((o) => (
                                    <option key={o} value={o}>
                                      {o}
                                    </option>
                                  ))}
                                </Select>
                                {inOther && (
                                  <Input
                                    data-result-field=""
                                    onKeyDown={enterToNextResult}
                                    value={v.value}
                                    autoFocus={otherOpen.has(id) && v.value === ""}
                                    disabled={locked || pending}
                                    aria-label={`${f.label}, other`}
                                    onChange={(e) => setValue(r.id, key, { value: e.target.value })}
                                    className="w-48"
                                  />
                                )}
                              </>
                            ) : (
                              <Input
                                data-result-field=""
                                onKeyDown={enterToNextResult}
                                value={v.value}
                                disabled={locked || pending}
                                inputMode={f.resultType === "numeric" ? "decimal" : undefined}
                                onChange={(e) => setValue(r.id, key, { value: e.target.value })}
                                title={calculated ? `= ${f.formula}` : undefined}
                                className={cn(f.resultType === "numeric" ? "w-32" : "w-64", calculated && "bg-sage-75/60", FLAG_TONE[flag])}
                              />
                            )}
                            {calculated && <span className="text-[11px] text-sage-500">Calculated</span>}
                            {flag !== "normal" && (
                              <span className={cn("text-[13px]", FLAG_TONE[flag])}>{flagSymbol(flag)}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-sage-600">{f.unit}</td>
                        <td className="px-4 py-2 text-sage-600">{f.refText || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            </>
            )}
          </section>
        );
      })}
          {g.holderId && (
            <div className="-mt-1 rounded-[10px] border border-dashed border-line bg-cream-100/60 px-4 py-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-sage-600">Note: {g.label}</span>
                <Input
                  onKeyDown={enterToNextResult}
                  value={draft[g.holderId]?.remarks ?? ""}
                  disabled={g.holderLocked || pending}
                  placeholder="Optional, printed on the report after the last test"
                  onChange={(e) => {
                    const id = g.holderId!;
                    setDraft((d) => ({ ...d, [id]: { ...d[id]!, remarks: e.target.value } }));
                  }}
                />
              </label>
            </div>
          )}
        </Fragment>
      ))}

      {sendDialog && (
        <SendOutDialog
          key={sendDialog.key}
          open
          onClose={() => setSendDialog(null)}
          orderId={orderId}
          tests={sendable.map((r) => ({ resultId: r.id, testName: r.testName, groupName: r.groupName }))}
          partners={partners}
          initial={sendDialog.initial}
          canAddPartner={canAddPartner}
        />
      )}

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
