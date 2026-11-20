import Link from "next/link";
import { requirePermission } from "@/lib/session";
import { balanceSheet, type BalanceSheetLine } from "@/lib/repos/ledger-reports";
import { accountsAsOf } from "@/lib/accounts-range";
import { ACCOUNT_GROUPS } from "@/lib/accounting";
import { formatPaisa } from "@/lib/money";
import { RangeBar } from "@/components/accounts/range-bar";
import { Statement } from "@/components/accounts/statement";
import { cn } from "@/lib/cn";

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<{ asof?: string }> }) {
  await requirePermission("accounts.view");
  const asOf = accountsAsOf(await searchParams);
  const bs = await balanceSheet(asOf.iso);
  const balanced = bs.totalAssetsPaisa === bs.totalLiabilitiesAndCapitalPaisa;

  return (
    <Statement
      title="Balance sheet"
      period={asOf.label}
      controls={<RangeBar asOf fromBs={asOf.bs} toBs={asOf.bs} label={asOf.label} />}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Side
          title="What the clinic owns"
          groups={groupLines(bs.assets)}
          total={bs.totalAssetsPaisa}
          asOf={asOf.iso}
        />
        <Side
          title="What it owes, and the owners' share"
          groups={[
            ...groupLines(bs.liabilities),
            ...groupLines(bs.equity),
          ]}
          extra={[
            ["Profit of earlier years", bs.profitEarlierPaisa],
            ["Profit this fiscal year", bs.profitThisYearPaisa],
          ]}
          total={bs.totalLiabilitiesAndCapitalPaisa}
          asOf={asOf.iso}
        />
      </div>
      <p className={cn("mt-2 text-[12px]", balanced ? "text-sage-500" : "font-semibold text-danger-600")}>
        {balanced ? "Both sides agree." : "The two sides do not agree. Open Checks."}
      </p>
    </Statement>
  );
}

function groupLines(lines: BalanceSheetLine[]): { label: string; lines: BalanceSheetLine[] }[] {
  const out: { label: string; lines: BalanceSheetLine[] }[] = [];
  for (const l of [...lines].sort((a, b) => a.account.code.localeCompare(b.account.code))) {
    const label = ACCOUNT_GROUPS[l.account.grp]?.label ?? l.account.grp;
    const g = out.find((x) => x.label === label);
    if (g) g.lines.push(l);
    else out.push({ label, lines: [l] });
  }
  return out;
}

function Side({
  title,
  groups,
  extra = [],
  total,
  asOf,
}: {
  title: string;
  groups: { label: string; lines: BalanceSheetLine[] }[];
  extra?: [string, number][];
  total: number;
  asOf: string;
}) {
  return (
    <div className="rounded-[10px] border border-line bg-cream-50">
      <h3 className="border-b border-line bg-sage-75 px-4 py-2 text-[14px] font-semibold text-sage-900">{title}</h3>
      <div className="px-4 py-2 text-[14px]">
        {groups.map((g) => (
          <div key={g.label} className="py-1.5">
            <div className="flex justify-between font-medium text-sage-900">
              <span>{g.label}</span>
              <span className="tnum">{formatPaisa(g.lines.reduce((s, l) => s + l.amountPaisa, 0), false)}</span>
            </div>
            {g.lines.map((l) => (
              <div key={l.account.id} className="flex justify-between pl-4 text-[13px] text-sage-600">
                <Link href={`/accounts/ledger/${encodeURIComponent(l.account.id)}?preset=fy`} className="hover:underline">
                  {l.account.name}
                </Link>
                <span className={cn("tnum", l.amountPaisa < 0 && "text-danger-600")}>{formatPaisa(l.amountPaisa, false)}</span>
              </div>
            ))}
          </div>
        ))}
        {extra
          .filter(([, v]) => v !== 0)
          .map(([label, v]) => (
            <div key={label} className="flex justify-between py-1.5 font-medium text-sage-900">
              <span>{label}</span>
              <span className={cn("tnum", v < 0 && "text-danger-600")}>{formatPaisa(v, false)}</span>
            </div>
          ))}
      </div>
      <div className="flex justify-between border-t border-line px-4 py-2 text-[15px] font-semibold text-sage-900">
        <span>Total</span>
        <span className="tnum">{formatPaisa(total, false)}</span>
      </div>
    </div>
  );
}
