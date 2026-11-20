import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission, can } from "@/lib/session";
import { balancesOn, fiscalYearStartOf } from "@/lib/repos/ledger-reports";
import { profitBetween } from "@/lib/repos/ledger";
import { accountsAsOf } from "@/lib/accounts-range";
import { formatPaisa } from "@/lib/money";
import { cn } from "@/lib/cn";

export default async function AccountsOverviewPage() {
  const user = await requirePermission(["accounts.view", "accounts.post", "accounts.setup"]);
  const today = accountsAsOf({});
  const balances = await balancesOn(today.iso);
  const profit = await profitBetween(fiscalYearStartOf(today.iso), today.iso);
  const money = balances.filter((b) => b.account.grp === "cash_bank" && (b.account.active || b.balancePaisa !== 0));
  const owedToUs = balances.filter((b) => b.account.grp === "receivable").reduce((s, b) => s + b.balancePaisa, 0);
  const weOwe = balances.filter((b) => b.account.grp === "payable").reduce((s, b) => s + b.balancePaisa, 0);
  const taxes = balances.filter((b) => b.account.grp === "duty_tax");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-sage-500">{today.label}</p>
        {can(user, "accounts.post") && (
          <div className="flex flex-wrap gap-2">
            {(["payment", "receipt", "contra", "journal"] as const).map((t) => (
              <Link
                key={t}
                href={`/accounts/vouchers/new?type=${t}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line bg-cream-50 px-3 text-[13px] font-medium text-sage-900 hover:bg-cream-200"
              >
                <Plus className="h-4 w-4" />
                {t === "payment" ? "Pay an expense" : t === "receipt" ? "Receive money" : t === "contra" ? "Cash ↔ bank" : "Journal"}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Owed to the clinic" value={owedToUs} href="/accounts/aging?side=receivable" />
        <Tile label="The clinic owes" value={weOwe} href="/accounts/aging?side=payable" />
        <Tile label="Profit this fiscal year" value={profit} href="/accounts/profit-loss?preset=fy" strong />
      </div>

      <section>
        <h2 className="mb-2 text-[15px] font-semibold text-sage-900">Cash and bank</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {money.map((m) => (
            <Link
              key={m.account.id}
              href={`/accounts/ledger/${encodeURIComponent(m.account.id)}`}
              className="rounded-[10px] border border-line bg-cream-50 p-4 hover:bg-cream-200"
            >
              <div className="text-[13px] text-sage-600">{m.account.name}</div>
              <div className={cn("mt-1 text-[18px] font-semibold tnum", m.balancePaisa < 0 ? "text-danger-600" : "text-sage-900")}>
                {formatPaisa(m.balancePaisa)}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {taxes.some((t) => t.balancePaisa !== 0) && (
        <section>
          <h2 className="mb-2 text-[15px] font-semibold text-sage-900">Taxes</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {taxes
              .filter((t) => t.balancePaisa !== 0)
              .map((t) => (
                <Tile key={t.account.id} label={t.account.name} value={t.balancePaisa} href={`/accounts/ledger/${encodeURIComponent(t.account.id)}`} />
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, href, strong }: { label: string; value: number; href: string; strong?: boolean }) {
  return (
    <Link href={href} className={cn("rounded-[10px] border border-line p-4 hover:bg-cream-200", strong ? "bg-sage-75" : "bg-cream-50")}>
      <div className="text-[13px] text-sage-600">{label}</div>
      <div className={cn("mt-1 text-[20px] font-semibold tnum", value < 0 ? "text-danger-600" : "text-sage-900")}>{formatPaisa(value)}</div>
    </Link>
  );
}
