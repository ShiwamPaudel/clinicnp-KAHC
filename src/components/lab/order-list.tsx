"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FlaskConical, Search, Printer, PenLine, ClipboardCheck, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { ORDER_STATUS_LABEL, orderTone } from "@/lib/lab-format";
import { formatPaisa } from "@/lib/money";

export interface OrderView {
  id: string;
  orderLabel: string;
  dateLabel: string;
  status: string;
  urgent: boolean;
  patientLabel: string;
  ageSex: string;
  invoiceLabel: string;
  testNames: string;
  progress: string;
  balancePaisa: number;
  correction: number;
  /** at least one approved result: there is a report to print */
  canPrint: boolean;
  /** "Vitamin D → City Lab", for tests sent to another laboratory */
  sentOut: string[];
}

export type OrderListMode = "results" | "approval" | "reports";

const EMPTY: Record<OrderListMode, string> = {
  results: "Nothing is waiting for results. Tests appear here once their sample is collected.",
  approval: "Nothing is waiting for approval.",
  reports: "No reports yet.",
};

/** One list for Result entry, Approval and Reports; the action differs. */
export function OrderList({ rows, mode, base }: { rows: OrderView[]; mode: OrderListMode; base: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(q.trim() ? `${base}?q=${encodeURIComponent(q.trim())}` : base);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Patient, phone, patient number, lab or bill number" className="w-80" />
        <Button variant="secondary" type="submit">
          <Search className="h-4 w-4" />
          Find
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState icon={FlaskConical} message={EMPTY[mode]} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Order</TH>
              <TH>Patient</TH>
              <TH>Tests</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <tbody>
            {rows.map((o) => (
              <TR key={o.id}>
                <TD>
                  <Link href={`/lab/orders/${o.id}`} className="font-mono text-[13px] font-semibold text-sage-900 hover:underline">
                    {o.orderLabel}
                  </Link>
                  <div className="text-[12px] text-sage-500">{o.dateLabel}</div>
                  {o.urgent && <Badge tone="danger" className="mt-1">Urgent</Badge>}
                </TD>
                <TD>
                  <div className="font-medium text-sage-900">{o.patientLabel}</div>
                  <div className="text-[12px] text-sage-500">
                    {o.ageSex}
                    {o.invoiceLabel && ` · ${o.invoiceLabel}`}
                  </div>
                </TD>
                <TD className="max-w-[340px] text-[13px] text-sage-700">
                  {o.testNames}
                  <div className="text-[12px] text-sage-500">{o.progress}</div>
                  {o.sentOut.length > 0 && (
                    <div className="mt-1 flex flex-col gap-0.5">
                      {o.sentOut.map((line) => (
                        <span key={line} className="flex items-center gap-1 text-[12px] text-info-600">
                          <Send className="h-3 w-3 shrink-0" />
                          {line}
                        </span>
                      ))}
                    </div>
                  )}
                </TD>
                <TD>
                  <Badge tone={orderTone(o.status)}>{ORDER_STATUS_LABEL[o.status] ?? o.status}</Badge>
                  {o.correction > 0 && <div className="mt-1 text-[12px] text-danger-600">{o.correction} sent back</div>}
                  {o.balancePaisa > 0 && (
                    <div className="mt-1 text-[12px] text-warn-600">Owes {formatPaisa(o.balancePaisa)}</div>
                  )}
                </TD>
                <TD className="text-right">
                  <div className="flex flex-wrap justify-end gap-1">
                    {mode === "results" && (
                      <Link href={`/lab/results/${o.id}`}>
                        <Button>
                          <PenLine className="h-4 w-4" />
                          Enter results
                        </Button>
                      </Link>
                    )}
                    {mode === "approval" && (
                      <Link href={`/lab/approval/${o.id}`}>
                        <Button>
                          <ClipboardCheck className="h-4 w-4" />
                          Review
                        </Button>
                      </Link>
                    )}
                    {mode === "reports" && o.canPrint && (
                      <a href={`/print/lab-report/${o.id}`} target="_blank" rel="noreferrer">
                        <Button>
                          <Printer className="h-4 w-4" />
                          Print
                        </Button>
                      </a>
                    )}
                  </div>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
