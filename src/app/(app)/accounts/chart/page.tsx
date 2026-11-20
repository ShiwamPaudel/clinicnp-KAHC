import { requirePermission, can } from "@/lib/session";
import { listAccounts } from "@/lib/repos/accounts";
import { balancesOn } from "@/lib/repos/ledger-reports";
import { accountsAsOf } from "@/lib/accounts-range";
import { ChartManager } from "@/components/accounts/chart-manager";

export default async function ChartPage() {
  const user = await requirePermission(["accounts.view", "accounts.setup"]);
  const [accounts, balances] = await Promise.all([
    listAccounts(),
    can(user, "accounts.view") ? balancesOn(accountsAsOf({}).iso) : Promise.resolve([]),
  ]);
  const bal = new Map(balances.map((b) => [b.account.id, b.balancePaisa]));
  return (
    <ChartManager
      canEdit={can(user, "accounts.setup")}
      showBalances={can(user, "accounts.view")}
      accounts={accounts.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        kind: a.kind,
        grp: a.grp,
        segment: a.segment,
        isBank: a.isBank,
        isSystem: a.systemKey !== null,
        isControl: a.isControl,
        inUse: a.inUse,
        note: a.note,
        active: a.active,
        balancePaisa: bal.get(a.id) ?? 0,
      }))}
    />
  );
}
