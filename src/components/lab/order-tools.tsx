"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Field } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { reopenAction, setOrderDetailsAction } from "@/app/(app)/lab/actions";
import { strings } from "@/lib/strings";

/** Referred by and urgency, editable until the order is cancelled. */
export function OrderDetailsForm({
  orderId,
  referredBy,
  priority,
}: {
  orderId: string;
  referredBy: string;
  priority: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [ref, setRef] = useState(referredBy);
  const [pri, setPri] = useState(priority === "urgent" ? "urgent" : "normal");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="Referred by">
        <Input value={ref} onChange={(e) => setRef(e.target.value)} className="w-64" maxLength={120} />
      </Field>
      <Field label="Priority">
        <Select value={pri} onChange={(e) => setPri(e.target.value)} className="w-36">
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </Select>
      </Field>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await setOrderDetailsAction({ orderId, referredBy: ref, priority: pri as "normal" | "urgent" });
            if (res.ok) {
              toast.success(strings.saved);
              router.refresh();
            } else toast.error(res.userMessage ?? strings.somethingWentWrong);
          })
        }
      >
        <Save className="h-4 w-4" />
        Save
      </Button>
    </div>
  );
}

/** Reopen approved results when a mistake is found after approval. */
export function ReopenButton({ orderId, results }: { orderId: string; results: { id: string; testName: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  if (results.length === 0) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <RotateCcw className="h-4 w-4" />
        Reopen results
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Reopen approved results"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {strings.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={pending || ids.length === 0}
              onClick={() =>
                start(async () => {
                  const res = await reopenAction({ orderId, resultIds: ids, reason });
                  if (res.ok) {
                    toast.success("Reopened — the patient's link waits until they are approved again");
                    setOpen(false);
                    router.refresh();
                  } else toast.error(res.userMessage ?? strings.somethingWentWrong);
                })
              }
            >
              Reopen
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-sage-600">
            The chosen tests go back to result entry. The report and the patient&apos;s link stop showing them until
            they are approved again.
          </p>
          {results.map((r) => (
            <label key={r.id} className="flex items-center gap-2 text-[14px]">
              <input
                type="checkbox"
                checked={ids.includes(r.id)}
                onChange={() => setIds((x) => (x.includes(r.id) ? x.filter((y) => y !== r.id) : [...x, r.id]))}
              />
              {r.testName}
            </label>
          ))}
          <Field label="What was wrong">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
