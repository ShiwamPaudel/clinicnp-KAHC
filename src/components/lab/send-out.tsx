"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { sendOutAction, undoSendOutAction } from "@/app/(app)/lab/actions";
import { strings } from "@/lib/strings";

export interface SendableTest {
  resultId: string;
  testName: string;
  groupName: string;
}

export interface PartnerOption {
  id: string;
  name: string;
}

/**
 * Send some of an order's tests to another laboratory. Opened from a test's
 * own button (that test ticked) or from the toolbar (none ticked).
 */
export function SendOutDialog({
  open,
  onClose,
  orderId,
  tests,
  partners,
  initial,
  canAddPartner,
}: {
  open: boolean;
  onClose: () => void;
  orderId: string;
  tests: SendableTest[];
  partners: PartnerOption[];
  initial: string[];
  canAddPartner: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial));
  const [partnerId, setPartnerId] = useState(partners.length === 1 ? partners[0]!.id : "");
  const [pending, start] = useTransition();

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function send() {
    start(async () => {
      const res = await sendOutAction({ orderId, resultIds: [...picked], partnerId });
      if (!res.ok) {
        toast.error(res.userMessage ?? strings.somethingWentWrong);
        return;
      }
      const n = picked.size;
      toast.success(`${n} test${n === 1 ? "" : "s"} sent${res.unpriced ? " · price not set yet" : ""}`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Send to another lab"
      className="max-w-lg"
      footer={
        partners.length > 0 ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {strings.cancel}
            </Button>
            <Button onClick={send} disabled={pending || picked.size === 0 || !partnerId}>
              <Send className="h-4 w-4" />
              {picked.size > 1 ? `Send ${picked.size} tests` : "Send"}
            </Button>
          </>
        ) : undefined
      }
    >
      {partners.length === 0 ? (
        <p className="text-[14px] text-sage-700">
          No outside laboratories yet.{" "}
          {canAddPartner && (
            <Link href="/settings/lab-partners" className="font-medium text-clinic-700 hover:underline">
              Add one
            </Link>
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Laboratory">
            <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
              <option value="">Choose…</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-sage-900">Tests</div>
            <ul className="flex max-h-[300px] flex-col divide-y divide-line overflow-y-auto rounded-[8px] border border-line bg-white">
              {tests.map((t) => (
                <li key={t.resultId}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[14px] hover:bg-cream-100">
                    <input type="checkbox" checked={picked.has(t.resultId)} onChange={() => toggle(t.resultId)} />
                    <span className="text-sage-900">{t.testName}</span>
                    {t.groupName && <span className="text-[12px] text-sage-500">{t.groupName}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** It was not really sent: bring the test back to Result entry. */
export function BringBackButton({ sendoutId, testName }: { sendoutId: string; testName: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  function undo() {
    start(async () => {
      const res = await undoSendOutAction({ sendoutId, reason });
      if (!res.ok) {
        toast.error(res.userMessage ?? strings.somethingWentWrong);
        return;
      }
      toast.success(`${testName} is back in Result entry`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Undo2 className="h-4 w-4" />
        Bring back
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Bring back ${testName}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {strings.cancel}
            </Button>
            <Button onClick={undo} disabled={pending || !reason.trim()}>
              Bring back
            </Button>
          </>
        }
      >
        <Field label="Why">
          <Input value={reason} autoFocus onChange={(e) => setReason(e.target.value)} placeholder="Done here instead" />
        </Field>
      </Dialog>
    </>
  );
}
