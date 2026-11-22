"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { setPartnerPriceAction } from "@/app/(app)/lab/actions";
import { formatPaisa, paisaToRupees, toPaisa } from "@/lib/money";
import { stampAt } from "@/lib/lab-format";
import { strings } from "@/lib/strings";
import type { PartnerPriceRow } from "@/lib/repos/lab-sendouts";

/**
 * What one laboratory charges for each test sent to it. A test appears here
 * by itself the first time it is sent; tests sent before their price was set
 * are charged when it is.
 */
export function PartnerPriceList({ partnerId, rows }: { partnerId: string; rows: PartnerPriceRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.testId, r.costPaisa == null ? "" : String(paisaToRupees(r.costPaisa))])),
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [, start] = useTransition();

  function save(r: PartnerPriceRow) {
    const raw = (values[r.testId] ?? "").replace(/,/g, "").trim();
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n) || n < 0) {
      toast.error("Enter the price in rupees.");
      return;
    }
    setSavingId(r.testId);
    start(async () => {
      const res = await setPartnerPriceAction({ partnerId, testId: r.testId, costPaisa: toPaisa(n) });
      setSavingId(null);
      if (!res.ok) {
        toast.error(res.userMessage ?? strings.somethingWentWrong);
        return;
      }
      toast.success(res.filled ? `Saved · ${res.filled} sent test${res.filled === 1 ? "" : "s"} charged` : strings.saved);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return <EmptyState icon={Tags} message="Nothing sent here yet. Tests appear once they are sent from Result entry." />;
  }

  return (
    <div className="rounded-[10px] border border-line bg-cream-50">
      <Table>
        <THead>
          <TR>
            <TH>Test</TH>
            <TH>Department</TH>
            <TH numeric>Sent</TH>
            <TH>Last sent</TH>
            <TH numeric>Charge (Rs)</TH>
            <TH />
          </TR>
        </THead>
        <tbody>
          {rows.map((r) => {
            const current = r.costPaisa == null ? "" : String(paisaToRupees(r.costPaisa));
            const dirty = (values[r.testId] ?? "") !== current;
            return (
              <TR key={r.testId}>
                <TD>
                  <div className="font-medium text-sage-900">{r.testName}</div>
                  {r.unpriced > 0 && (
                    <Badge tone="warn" className="mt-1">
                      {r.unpriced} waiting for this price
                    </Badge>
                  )}
                </TD>
                <TD className="text-[13px] text-sage-600">{r.departmentName || "-"}</TD>
                <TD numeric>{r.timesSent}</TD>
                <TD className="text-[13px] text-sage-600">{r.lastSentAt ? stampAt(r.lastSentAt) : "-"}</TD>
                <TD numeric>
                  <div className="ml-auto w-32">
                  <Input
                    numeric
                    inputMode="decimal"
                    value={values[r.testId] ?? ""}
                    placeholder="Not set"
                    onChange={(e) => setValues((v) => ({ ...v, [r.testId]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") save(r);
                    }}
                  />
                  </div>
                </TD>
                <TD className="w-[96px] text-right">
                  {dirty ? (
                    <Button onClick={() => save(r)} disabled={savingId === r.testId}>
                      {strings.save}
                    </Button>
                  ) : r.costPaisa != null ? (
                    <span className="text-[12px] text-sage-500">{formatPaisa(r.costPaisa)}</span>
                  ) : null}
                </TD>
              </TR>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
