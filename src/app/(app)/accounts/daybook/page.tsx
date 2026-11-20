import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { dayBookLines } from "@/lib/repos/ledger";
import { accountsRange } from "@/lib/accounts-range";
import { amountOrBlank, bsOf, partyHref, SOURCE_LABEL } from "@/lib/accounts-view";
import { formatPaisa } from "@/lib/money";
import { RangeBar } from "@/components/accounts/range-bar";
import { Statement } from "@/components/accounts/statement";
import { ExportLink } from "@/components/accounts/export-link";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";

const LIMIT = 5000;

export default async function DayBookPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requirePermission("accounts.view");
  const sp = await searchParams;
  const range = accountsRange({ preset: sp.preset ?? (sp.from ? undefined : "today"), from: sp.from, to: sp.to });
  const lines = await dayBookLines(range.fromIso, range.toIso, LIMIT + 1);
  const shown = lines.slice(0, LIMIT);
  const dr = shown.reduce((s, l) => s + l.drPaisa, 0);
  const cr = shown.reduce((s, l) => s + l.crPaisa, 0);

  // One block per document, in the order they happened.
  const blocks: { key: string; lines: typeof shown }[] = [];
  for (const l of shown) {
    const key = `${l.src}:${l.srcId}:${l.dateAd}`;
    const last = blocks[blocks.length - 1];
    if (last && last.key === key) last.lines.push(l);
    else blocks.push({ key, lines: [l] });
  }

  return (
    <Statement
      title="Day book"
      actions={<ExportLink report="daybook" />}
      period={range.label}
      controls={<RangeBar preset={range.preset} fromBs={range.fromBs} toBs={range.toBs} label={range.label} />}
    >
      {blocks.length === 0 ? (
        <EmptyState message="Nothing happened in this period." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Date</TH>
              <TH>What</TH>
              <TH>Account</TH>
              <TH>Detail</TH>
              <TH numeric>Debit</TH>
              <TH numeric>Credit</TH>
            </TR>
          </THead>
          <tbody>
            {blocks.map((b) =>
              b.lines.map((l, i) => (
                <TR key={`${b.key}:${i}`} className={i === 0 ? "border-t-2 border-t-line" : undefined}>
                  <TD className="whitespace-nowrap text-sage-600">{i === 0 ? bsOf(l.dateAd) : ""}</TD>
                  <TD className="whitespace-nowrap">
                    {i === 0 && (
                      <Link href={l.link} className="text-sage-700 hover:underline">
                        {SOURCE_LABEL[l.src] ?? l.src}
                        {l.doc ? <span className="ml-1 text-[12px] text-sage-500">{l.doc}</span> : null}
                      </Link>
                    )}
                  </TD>
                  <TD>
                    <Link href={`/accounts/ledger/${encodeURIComponent(l.accountId)}`} className="hover:underline">
                      {l.accountName}
                    </Link>
                    {l.partyType && l.partyId !== null && (
                      <Link href={partyHref(l.partyType, l.partyId)} className="ml-1 text-[12px] text-sage-500 hover:underline">
                        · {l.partyName || "No name"}
                      </Link>
                    )}
                  </TD>
                  <TD className="text-[13px] text-sage-600">{l.narration}</TD>
                  <TD numeric>{amountOrBlank(l.drPaisa)}</TD>
                  <TD numeric>{amountOrBlank(l.crPaisa)}</TD>
                </TR>
              )),
            )}
            <TR className="bg-sage-75 font-semibold">
              <TD> </TD>
              <TD>Total</TD>
              <TD> </TD>
              <TD> </TD>
              <TD numeric>{formatPaisa(dr, false)}</TD>
              <TD numeric>{formatPaisa(cr, false)}</TD>
            </TR>
          </tbody>
        </Table>
      )}
      {lines.length > LIMIT && (
        <p className="mt-2 text-[12px] text-sage-500">Only the first {LIMIT.toLocaleString()} lines are shown. Choose a shorter period.</p>
      )}
    </Statement>
  );
}
