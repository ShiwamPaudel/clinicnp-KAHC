"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Field } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cancelVoucherAction } from "@/app/(app)/accounts/actions";
import { strings } from "@/lib/strings";

/** Cancel a voucher: reversed today, kept on its own day. */
export function CancelVoucher({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    const res = await cancelVoucherAction({ id, reason });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.userMessage ?? strings.somethingWentWrong);
      return;
    }
    toast.success("Cancelled");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Cancel voucher
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Cancel this voucher?">
        <p className="mb-4 text-[14px] text-sage-700">
          It is reversed today and kept, marked cancelled.
        </p>
        <Field label="Why">
          <Input value={reason} autoFocus onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={go} disabled={busy || !reason.trim()}>
            {busy ? "Cancelling…" : "Cancel voucher"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
