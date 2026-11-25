import { requirePermission } from "@/lib/session";
import { requireModulePage } from "@/lib/modules";
import { listItems } from "@/lib/repos/items";
import { stockLedger } from "@/lib/repos/stock-ledger";
import { adToIso, bsFromDbText, bsToDbText, toAD, today } from "@/lib/bs";
import { bsTextNumeric, stampNumeric } from "@/lib/print-format";
import { toMixedDisplay } from "@/lib/units";
import { ReportFrame } from "@/components/app/report-frame";
import { StockLedgerFilter } from "@/components/app/stock-ledger-filter";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import type { UnitDef } from "@/lib/units";

export const metadata = { title: "Stock ledger" };

/** A BS date from the address, or null when it is missing or not a real day. */
function validBs(s: string | undefined): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  try {
    return Number.isNaN(toAD(bsFromDbText(s)).getTime()) ? null : s;
  } catch {
    return null;
  }
}

/** "2 Box + 3 Strip", with a minus in front of a shortfall. */
function qty(base: number, units: UnitDef[]): string {
  if (base === 0) return "0";
  const s = toMixedDisplay(Math.abs(base), units);
  return base < 0 ? `− ${s}` : s;
}

export default async function StockLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; from?: string; to?: string }>;
}) {
  await requirePermission("reports.all");
  await requireModulePage("pharmacy");
  const sp = await searchParams;

  const t = today();
  const fromBs = validBs(sp.from) ?? bsToDbText({ ...t, day: 1 });
  const toBs = validBs(sp.to) ?? bsToDbText(t);
  const items = await listItems(true);
  const item = sp.item ? items.find((i) => i.id === sp.item) ?? null : null;
  const ledger =
    item && fromBs <= toBs
      ? await stockLedger(item.id, adToIso(toAD(bsFromDbText(fromBs))), adToIso(toAD(bsFromDbText(toBs))))
      : null;
  const units = item?.units ?? [];

  return (
    <ReportFrame
      title="Stock ledger"
      rangeLabel={`${bsTextNumeric(fromBs)} to ${bsTextNumeric(toBs)}`}
      showRange={false}
      showFiscalYear={false}
    >
      <StockLedgerFilter items={items} itemId={item?.id ?? ""} fromBs={fromBs} toBs={toBs} />

      {!item || !ledger ? (
        <EmptyState message="Choose a medicine and the dates, then Show." />
      ) : (
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-[17px] font-semibold text-sage-900">{item.brandName}</h2>
            {item.genericName && <p className="text-[13px] text-sage-500">{item.genericName}</p>}
          </div>

          {/* the summary: opening, each kind of movement, closing */}
          <div className="max-w-[560px] rounded-[10px] border border-line bg-cream-50 p-4 text-[14px]">
            <Row label={`Opening stock on ${bsTextNumeric(fromBs)}`} value={qty(ledger.openingBase, units)} strong />
            {ledger.groups.map((g) => (
              <div key={g.group}>
                {g.inBase > 0 && <Row label={`+ ${g.label}`} value={qty(g.inBase, units)} />}
                {g.outBase > 0 && <Row label={`− ${g.label}`} value={qty(g.outBase, units)} />}
              </div>
            ))}
            {ledger.groups.length === 0 && <Row label="No movement in these dates" value="" />}
            <div className="mt-2 border-t border-line pt-2">
              <Row label={`Closing stock on ${bsTextNumeric(toBs)}`} value={qty(ledger.closingBase, units)} strong />
            </div>
          </div>

          {ledger.lines.length > 0 && (
            <div className="overflow-x-auto rounded-[10px] border border-line bg-cream-50">
              <Table>
                <THead>
                  <TR>
                    <TH>Date / Time</TH>
                    <TH>Particulars</TH>
                    <TH>Reference</TH>
                    <TH>Batch no.</TH>
                    <TH numeric>In</TH>
                    <TH numeric>Out</TH>
                    <TH numeric>Balance</TH>
                  </TR>
                </THead>
                <tbody>
                  <TR>
                    <TD className="font-mono text-[13px]">{bsTextNumeric(fromBs)}</TD>
                    <TD className="font-medium">Opening stock</TD>
                    <TD />
                    <TD />
                    <TD numeric />
                    <TD numeric />
                    <TD numeric className="font-medium">{qty(ledger.openingBase, units)}</TD>
                  </TR>
                  {ledger.lines.map((l, i) => (
                    <TR key={i}>
                      <TD className="whitespace-nowrap font-mono text-[13px]">{stampNumeric(l.at)}</TD>
                      <TD>{l.particulars}</TD>
                      <TD className="text-sage-600">
                        {[l.docNo, l.party].filter(Boolean).join(" · ") || "-"}
                      </TD>
                      <TD className="font-mono text-[13px]">{l.batchNo}</TD>
                      <TD numeric>{l.inBase ? qty(l.inBase, units) : ""}</TD>
                      <TD numeric>{l.outBase ? qty(l.outBase, units) : ""}</TD>
                      <TD numeric>{qty(l.balanceBase, units)}</TD>
                    </TR>
                  ))}
                  <TR>
                    <TD className="font-mono text-[13px]">{bsTextNumeric(toBs)}</TD>
                    <TD className="font-medium">Closing stock</TD>
                    <TD />
                    <TD />
                    <TD numeric className="font-medium">{qty(ledger.inBase, units)}</TD>
                    <TD numeric className="font-medium">{qty(ledger.outBase, units)}</TD>
                    <TD numeric className="font-semibold">{qty(ledger.closingBase, units)}</TD>
                  </TR>
                </tbody>
              </Table>
            </div>
          )}
        </div>
      )}
    </ReportFrame>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-0.5 ${strong ? "font-semibold text-sage-900" : "text-sage-700"}`}>
      <span>{label}</span>
      <span className="tnum text-right">{value}</span>
    </div>
  );
}
