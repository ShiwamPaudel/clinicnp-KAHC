import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { getModules } from "@/lib/modules";
import { profitAndLoss, type PnlRow, type SegmentKey } from "@/lib/repos/ledger-reports";
import { accountsRange } from "@/lib/accounts-range";
import { formatPaisa } from "@/lib/money";
import { RangeBar } from "@/components/accounts/range-bar";
import { Statement } from "@/components/accounts/statement";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { cn } from "@/lib/cn";

const SEG_LABEL: Record<SegmentKey, string> = {
  pharmacy: "Pharmacy",
  clinic: "Clinic",
  lab: "Laboratory",
  common: "Whole clinic",
};

export default async function ProfitLossPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requirePermission("accounts.view");
  const range = accountsRange(await searchParams, "fy");
  const [pl, modules] = await Promise.all([profitAndLoss(range.fromIso, range.toIso), getModules()]);
  // Only the parts this clinic runs get a column; "whole clinic" always does.
  const segs: SegmentKey[] = [
    ...(modules.pharmacy ? (["pharmacy"] as const) : []),
    ...(modules.clinic ? (["clinic"] as const) : []),
    ...(modules.lab || modules.clinic ? (["lab"] as const) : []),
    "common",
  ];
  const link = (id: string) => `/accounts/ledger/${encodeURIComponent(id)}?from=${range.fromIso}&to=${range.toIso}`;

  const section = (title: string, rows: PnlRow[]) =>
    rows.length === 0 ? null : (
      <>
        <TR className="bg-cream-100">
          <TD className="font-semibold text-sage-900">{title}</TD>
          {segs.map((s) => (
            <TD key={s}> </TD>
          ))}
          <TD> </TD>
        </TR>
        {rows.map((r) => (
          <TR key={r.account.id}>
            <TD className="pl-6">
              <Link href={link(r.account.id)} className="hover:underline">
                {r.account.name}
              </Link>
            </TD>
            {segs.map((s) => (
              <TD key={s} numeric>
                {r.bySegment[s] === 0 ? "" : formatPaisa(r.bySegment[s], false)}
              </TD>
            ))}
            <TD numeric className="font-medium">
              {formatPaisa(r.totalPaisa, false)}
            </TD>
          </TR>
        ))}
      </>
    );

  const totalRow = (label: string, v: Record<SegmentKey, number> & { total: number }, strong = false) => (
    <TR className={cn(strong ? "bg-sage-75 font-semibold" : "bg-cream-100 font-medium")}>
      <TD>{label}</TD>
      {segs.map((s) => (
        <TD key={s} numeric className={v[s] < 0 ? "text-danger-600" : undefined}>
          {formatPaisa(v[s], false)}
        </TD>
      ))}
      <TD numeric className={v.total < 0 ? "text-danger-600" : undefined}>
        {formatPaisa(v.total, false)}
      </TD>
    </TR>
  );

  return (
    <Statement
      title="Profit and loss"
      period={range.label}
      controls={<RangeBar preset={range.preset} fromBs={range.fromBs} toBs={range.toBs} label={range.label} />}
    >
      <Table>
        <THead>
          <TR>
            <TH> </TH>
            {segs.map((s) => (
              <TH key={s} numeric>
                {SEG_LABEL[s]}
              </TH>
            ))}
            <TH numeric>Total</TH>
          </TR>
        </THead>
        <tbody>
          {section("Sales and services", pl.directIncome)}
          {section("Direct costs", pl.directExpense)}
          {totalRow("Gross profit", pl.grossProfit)}
          {section("Other income", pl.indirectIncome)}
          {section("Running costs", pl.indirectExpense)}
          {totalRow(pl.netProfit.total >= 0 ? "Net profit" : "Net loss", pl.netProfit, true)}
        </tbody>
      </Table>
    </Statement>
  );
}
