"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input, Field } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { approveOrderAction, sendBackAction } from "@/app/(app)/lab/actions";
import { flagSymbol } from "@/lib/lab-flags";
import { RESULT_STATUS_LABEL, resultTone } from "@/lib/lab-format";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/cn";
import type { OrderResult } from "@/lib/repos/lab-orders";

export interface SignatoryOption {
  id: string;
  name: string;
  description: string;
}

export function ResultValues({ result }: { result: OrderResult }) {
  if (result.values.length === 0) return <p className="px-4 py-2 text-[13px] text-sage-500">No values yet.</p>;
  return (
    <table className="w-full text-[14px]">
      <thead className="text-[12px] text-sage-500">
        <tr>
          <th className="px-4 py-1.5 text-left font-medium">Test</th>
          <th className="px-2 py-1.5 text-left font-medium">Result</th>
          <th className="px-2 py-1.5 text-left font-medium">Unit</th>
          <th className="px-2 py-1.5 text-left font-medium">Reference range</th>
          <th className="px-4 py-1.5 text-left font-medium">Remark</th>
        </tr>
      </thead>
      <tbody>
        {result.values.map((v) => (
          <tr key={v.id} className="border-t border-line">
            <td className="px-4 py-1.5">{v.label}</td>
            <td className={cn("px-2 py-1.5 font-medium", v.flag !== "normal" && "text-danger-600")}>
              {v.valueText || "-"} {flagSymbol(v.flag)}
            </td>
            <td className="px-2 py-1.5 text-sage-600">{v.unit}</td>
            <td className="px-2 py-1.5 text-sage-600">{v.refText || "-"}</td>
            <td className="px-4 py-1.5 text-sage-600">{v.remarks}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Check, comment, approve. Approving releases the tests to the report, signed
 * by the active signatures in their set order (owner, 2083-08-08: no choosing
 * here). Signatures are set up under Settings → Lab report.
 */
export function ApprovalPanel({
  orderId,
  results,
  signatories,
}: {
  orderId: string;
  results: OrderResult[];
  signatories: SignatoryOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const submitted = results.filter((r) => r.status === "submitted");
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(submitted.map((r) => [r.id, r.interpretation])),
  );
  const [backOpen, setBackOpen] = useState(false);
  const [backIds, setBackIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");

  function approve() {
    start(async () => {
      const res = await approveOrderAction({ orderId, signatoryIds: [], interpretations: notes });
      if (!res.ok) return toast.error(res.userMessage ?? strings.somethingWentWrong);
      toast.success(res.stillPending ? `Approved. ${res.stillPending} test(s) still to come` : "Approved. The report is ready");
      router.push("/lab/approval");
      router.refresh();
    });
  }

  function sendBack() {
    start(async () => {
      const res = await sendBackAction({ orderId, resultIds: backIds, reason });
      if (!res.ok) return toast.error(res.userMessage ?? strings.somethingWentWrong);
      toast.success("Sent back for correction");
      setBackOpen(false);
      router.push("/lab/approval");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {results.map((r) => (
        <section key={r.id} className="rounded-[10px] border border-line bg-cream-50">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div>
              <span className="text-[15px] font-semibold text-sage-900">{r.testName}</span>
              {r.groupName && <span className="ml-2 text-[12px] text-sage-500">{r.groupName}</span>}
              {r.enteredByName && <span className="ml-2 text-[12px] text-sage-500">· entered by {r.enteredByName}</span>}
            </div>
            <div className="flex gap-1">
              {r.hasCritical && <Badge tone="danger-solid">Critical</Badge>}
              <Badge tone={resultTone(r.status)}>{RESULT_STATUS_LABEL[r.status] ?? r.status}</Badge>
            </div>
          </header>
          <ResultValues result={r} />
          {r.technicianRemarks && <p className="border-t border-line px-4 py-2 text-[13px] text-sage-600">Note: {r.technicianRemarks}</p>}
          {r.status === "submitted" && (
            <div className="border-t border-line px-4 py-2">
              <Input
                value={notes[r.id] ?? ""}
                placeholder="Comment for the report (optional)"
                onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
              />
            </div>
          )}
        </section>
      ))}

      {submitted.length > 0 && (
        <section className="rounded-[10px] border border-line bg-cream-50 p-4">
          {signatories.length === 0 && (
            <p className="text-[13px] text-warn-600">
              No signatures are set up yet. Add them under Settings → Lab report before approving.
            </p>
          )}
          <div className={cn("flex justify-end gap-2", signatories.length === 0 && "mt-3")}>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setBackIds(submitted.map((r) => r.id));
                setBackOpen(true);
              }}
            >
              <Undo2 className="h-4 w-4" />
              Send back
            </Button>
            <Button disabled={pending || signatories.length === 0} onClick={approve}>
              <CheckCircle2 className="h-4 w-4" />
              Approve {submitted.length} test{submitted.length === 1 ? "" : "s"}
            </Button>
          </div>
        </section>
      )}

      <Dialog
        open={backOpen}
        onClose={() => setBackOpen(false)}
        title="Send back for correction"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBackOpen(false)}>
              {strings.cancel}
            </Button>
            <Button variant="destructive" disabled={pending || backIds.length === 0} onClick={sendBack}>
              Send back
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {submitted.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-[14px]">
              <input
                type="checkbox"
                checked={backIds.includes(r.id)}
                onChange={() => setBackIds((ids) => (ids.includes(r.id) ? ids.filter((x) => x !== r.id) : [...ids, r.id]))}
              />
              {r.testName}
            </label>
          ))}
          <Field label="What needs correcting">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
