import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { agingReport } from "@/lib/repos/ledger-reports";
import { accountsAsOf } from "@/lib/accounts-range";
import { AGING_BUCKETS, PARTY_TYPE_LABEL } from "@/lib/accounting";
import { bsOf, partyHref } from "@/lib/accounts-view";
import { formatPaisa } from "@/lib/money";
import { RangeBar } from "@/components/accounts/range-bar";
import { Statement } from "@/components/accounts/statement";
import { ExportLink } from "@/components/accounts/export-link";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

export default async function AgingPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string; asof?: string }>;
}) {
  await requirePermission("accounts.view");
  const sp = await searchParams;
  const side = sp.side === "payable" ? "payable" : "receivable";
  const asOf = accountsAsOf(sp);
  const r = await agingReport(side, asOf.iso);
  const title = side === "receivable" ? "Who owes the clinic" : "Whom the clinic owes";

  return (
    <Statement
      title={`${title} — by age`}
      period={asOf.label}
      actions={<ExportLink report="aging" extra={{ side }} />}
      controls={
        <>
          <div className="no-print mb-3 flex gap-1.5">
            {(["receivable", "payable"] as const).map((s) => (
              <Link
                key={s}
                href={`/accounts/aging?side=${s}${sp.asof ? `&asof=${sp.asof}` : ""}`}
                className={cn(
                  "rounded-[999px] border px-3 py-1.5 text-[13px]",
                  side === s ? "border-sage-700 bg-sage-700 text-cream-50" : "border-line bg-cream-50 text-sage-700 hover:bg-cream-200",
                )}
              >
                {s === "receivable" ? "Owed to the clinic" : "The clinic owes"}
              </Link>
            ))}
          </div>
          <RangeBar asOf fromBs={asOf.bs} toBs={asOf.bs} label={asOf.label} />
        </>
      }
    >
      {r.rows.length === 0 ? (
        <EmptyState message={side === "receivable" ? "Nobody owes the clinic anything." : "The clinic owes nobody anything."} />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Oldest bill</TH>
              {AGING_BUCKETS.map((b) => (
                <TH key={b.key} numeric>
                  {b.label}
                </TH>
              ))}
              <TH numeric>Total</TH>
            </TR>
          </THead>
          <tbody>
            {r.rows.map((row) => (
              <TR key={`${row.partyType}:${row.partyId}`}>
                <TD>
                  <Link href={partyHref(row.partyType, row.partyId)} className="font-medium text-sage-900 hover:underline">
                    {row.name || "No name"}
                  </Link>
                  <div className="text-[12px] text-sage-500">
                    {PARTY_TYPE_LABEL[row.partyType]}
                    {row.advancePaisa !== 0 && ` · ${formatPaisa(Math.abs(row.advancePaisa))} paid ahead`}
                  </div>
                </TD>
                <TD className="whitespace-nowrap text-sage-600">{row.oldestDateAd ? bsOf(row.oldestDateAd) : ""}</TD>
                {AGING_BUCKETS.map((b) => (
                  <TD key={b.key} numeric className={cn(b.min > 90 && row.buckets[b.key] > 0 && "text-danger-600")}>
                    {row.buckets[b.key] ? formatPaisa(row.buckets[b.key], false) : ""}
                  </TD>
                ))}
                <TD numeric className="font-semibold">
                  {formatPaisa(row.openPaisa, false)}
                </TD>
              </TR>
            ))}
            <TR className="bg-sage-75 font-semibold">
              <TD>Total</TD>
              <TD> </TD>
              {AGING_BUCKETS.map((b) => (
                <TD key={b.key} numeric>
                  {formatPaisa(r.totals[b.key], false)}
                </TD>
              ))}
              <TD numeric>{formatPaisa(r.totalOpenPaisa, false)}</TD>
            </TR>
          </tbody>
        </Table>
      )}
      <p className="mt-2 text-[12px] text-sage-500">
        Counted from each bill&apos;s date. Patients&apos; dues are bill by bill, exactly as on the Dues list; for
        everyone else, each payment clears their oldest bill first.
      </p>
    </Statement>
  );
}
