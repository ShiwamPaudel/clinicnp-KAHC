"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { TestTube, Printer, Check, X, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Field } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { collectSampleAction, rejectSampleAction, resetSampleAction } from "@/app/(app)/lab/actions";
import { SAMPLE_STATUS_LABEL } from "@/lib/lab-format";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/cn";

export interface SampleView {
  id: string;
  code: string;
  status: string;
  sampleTypeName: string;
  rejectionReason: string;
  collectedLabel: string;
  waitingLabel: string;
  orderId: string;
  orderLabel: string;
  urgent: boolean;
  patientLabel: string;
  ageSex: string;
  testNames: string;
}

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "To collect & recent" },
  { key: "waiting", label: "To collect" },
  { key: "recollection", label: "Draw again" },
  { key: "collected", label: "Collected" },
  { key: "rejected", label: "Rejected" },
];

/** Sample collection: draw, label, or turn away a sample, one row per tube. */
export function SampleQueue({ rows }: { rows: SampleView[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState<SampleView | null>(null);
  const [reason, setReason] = useState("");
  const [q, setQ] = useState(params.get("q") ?? "");
  const status = params.get("status") ?? "";

  function go(next: { status?: string; q?: string }) {
    const sp = new URLSearchParams();
    const s = next.status ?? status;
    const term = next.q ?? q;
    if (s) sp.set("status", s);
    if (term.trim()) sp.set("q", term.trim());
    router.push(`/lab/samples${sp.toString() ? `?${sp}` : ""}`);
  }

  function run(fn: () => Promise<{ ok: boolean; userMessage?: string }>, done?: string) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.userMessage ?? done ?? strings.saved);
        router.refresh();
      } else toast.error(res.userMessage ?? strings.somethingWentWrong);
    });
  }

  async function reject(recollect: boolean) {
    if (!rejecting) return;
    const res = await rejectSampleAction({ sampleId: rejecting.id, reason, recollect });
    if (res.ok) {
      toast.success(recollect ? "Marked to draw again" : "Sample rejected");
      setRejecting(null);
      setReason("");
      router.refresh();
    } else toast.error(res.userMessage ?? strings.somethingWentWrong);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => go({ status: f.key })}
            className={cn(
              "rounded-[999px] border px-3 py-1.5 text-[13px]",
              status === f.key ? "border-sage-700 bg-sage-700 text-cream-50" : "border-line bg-cream-50 text-sage-700 hover:bg-cream-200",
            )}
          >
            {f.label}
          </button>
        ))}
        <form
          className="ml-auto flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q });
          }}
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sample, patient, phone or number" className="w-72" />
          <Button variant="secondary" type="submit">
            <Search className="h-4 w-4" />
            Find
          </Button>
        </form>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={TestTube} message="No samples are waiting. New ones appear here as soon as a bill with a lab test is saved." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Sample</TH>
              <TH>Patient</TH>
              <TH>Tests on this tube</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <tbody>
            {rows.map((s) => (
              <TR key={s.id}>
                <TD>
                  <div className="font-mono text-[13px] font-semibold text-sage-900">{s.code}</div>
                  <div className="text-[12px] text-sage-500">{s.sampleTypeName || "-"}</div>
                  {s.urgent && <Badge tone="danger" className="mt-1">Urgent</Badge>}
                </TD>
                <TD>
                  <Link href={`/lab/orders/${s.orderId}`} className="font-medium text-sage-900 hover:underline">
                    {s.patientLabel}
                  </Link>
                  <div className="text-[12px] text-sage-500">
                    {s.ageSex} · {s.orderLabel}
                  </div>
                </TD>
                <TD className="max-w-[320px] text-[13px] text-sage-700">{s.testNames}</TD>
                <TD>
                  <Badge tone={s.status === "collected" ? "ok" : s.status === "waiting" ? "warn" : "danger"}>
                    {SAMPLE_STATUS_LABEL[s.status] ?? s.status}
                  </Badge>
                  <div className="mt-1 text-[12px] text-sage-500">
                    {s.status === "collected" ? s.collectedLabel : s.waitingLabel}
                  </div>
                  {s.rejectionReason && <div className="mt-1 text-[12px] text-danger-600">{s.rejectionReason}</div>}
                </TD>
                <TD className="text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    <a href={`/print/lab-label/${s.id}`} target="_blank" rel="noreferrer">
                      <Button variant="ghost" title="Print label">
                        <Printer className="h-4 w-4" />
                        Label
                      </Button>
                    </a>
                    {(s.status === "waiting" || s.status === "recollection") && (
                      <>
                        <Button disabled={pending} onClick={() => run(() => collectSampleAction(s.id))}>
                          <Check className="h-4 w-4" />
                          Mark collected
                        </Button>
                        <Button variant="ghost" disabled={pending} onClick={() => setRejecting(s)}>
                          <X className="h-4 w-4" />
                          Reject
                        </Button>
                      </>
                    )}
                    {s.status === "rejected" && (
                      <Button variant="secondary" disabled={pending} onClick={() => run(() => resetSampleAction(s.id), "Ready to draw again")}>
                        <RotateCcw className="h-4 w-4" />
                        Draw again
                      </Button>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title={rejecting ? `Turn away ${rejecting.code}?` : ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              {strings.cancel}
            </Button>
            <Button variant="secondary" onClick={() => reject(true)}>
              Draw again
            </Button>
            <Button variant="destructive" onClick={() => reject(false)}>
              Reject
            </Button>
          </>
        }
      >
        <Field label="Why" hint="For example: haemolysed, clotted, not enough, wrong tube">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      </Dialog>
    </div>
  );
}
