import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { trialBalance } from "@/lib/repos/ledger-reports";
import { accountsRange } from "@/lib/accounts-range";
import { amountOrBlank } from "@/lib/accounts-view";
import { formatPaisa } from "@/lib/money";
import { RangeBar } from "@/components/accounts/range-bar";
import { Statement } from "@/components/accounts/statement";
import { ExportLink } from "@/components/accounts/export-link";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requirePermission("accounts.view");
  const range = accountsRange(await searchParams, "fy");
  const tb = await trialBalance(range.fromIso, range.toIso);
  const t = tb.totals;
  const balanced = t.closingDr === t.closingCr;

  return (
    <Statement
      title="Trial balance"
      actions={<ExportLink report="trial-balance" />}
      period={range.label}
      controls={<RangeBar preset={range.preset} fromBs={range.fromBs} toBs={range.toBs} label={range.label} />}
    >
      {tb.rows.length === 0 && tb.earlierProfitPaisa === 0 ? (
        <EmptyState message="Nothing has been entered in the books yet." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Account</TH>
              <TH numeric>Opening Dr</TH>
              <TH numeric>Opening Cr</TH>
              <TH numeric>Debit</TH>
              <TH numeric>Credit</TH>
              <TH numeric>Closing Dr</TH>
              <TH numeric>Closing Cr</TH>
            </TR>
          </THead>
          <tbody>
            {tb.rows.map((r) => (
              <TR key={r.account.id}>
                <TD>
                  <Link href={`/accounts/ledger/${encodeURIComponent(r.account.id)}?from=${range.fromIso}&to=${range.toIso}`} className="hover:underline">
                    <span className="mr-2 text-[12px] text-sage-500 tnum">{r.account.code}</span>
                    {r.account.name}
                  </Link>
                </TD>
                <TD numeric>{amountOrBlank(Math.max(0, r.openingPaisa))}</TD>
                <TD numeric>{amountOrBlank(Math.max(0, -r.openingPaisa))}</TD>
                <TD numeric>{amountOrBlank(r.drPaisa)}</TD>
                <TD numeric>{amountOrBlank(r.crPaisa)}</TD>
                <TD numeric>{amountOrBlank(Math.max(0, r.closingPaisa))}</TD>
                <TD numeric>{amountOrBlank(Math.max(0, -r.closingPaisa))}</TD>
              </TR>
            ))}
            {tb.earlierProfitPaisa !== 0 && (
              <TR>
                <TD className="italic text-sage-700">Profit of earlier years</TD>
                <TD numeric>{amountOrBlank(Math.max(0, -tb.earlierProfitPaisa))}</TD>
                <TD numeric>{amountOrBlank(Math.max(0, tb.earlierProfitPaisa))}</TD>
                <TD numeric> </TD>
                <TD numeric> </TD>
                <TD numeric>{amountOrBlank(Math.max(0, -tb.earlierProfitPaisa))}</TD>
                <TD numeric>{amountOrBlank(Math.max(0, tb.earlierProfitPaisa))}</TD>
              </TR>
            )}
            <TR className="bg-sage-75 font-semibold">
              <TD>Total</TD>
              <TD numeric>{formatPaisa(t.openingDr, false)}</TD>
              <TD numeric>{formatPaisa(t.openingCr, false)}</TD>
              <TD numeric>{formatPaisa(t.dr, false)}</TD>
              <TD numeric>{formatPaisa(t.cr, false)}</TD>
              <TD numeric>{formatPaisa(t.closingDr, false)}</TD>
              <TD numeric>{formatPaisa(t.closingCr, false)}</TD>
            </TR>
          </tbody>
        </Table>
      )}
      <p className={cn("mt-2 text-[12px]", balanced ? "text-sage-500" : "font-semibold text-danger-600")}>
        {balanced ? "Both sides agree." : "The two sides do not agree. Open Checks."}
      </p>
    </Statement>
  );
}
