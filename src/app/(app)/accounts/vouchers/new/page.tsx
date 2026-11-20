import Link from "next/link";
import { requirePermission, can } from "@/lib/session";
import { listAccounts, listPartyChoices } from "@/lib/repos/accounts";
import { isVoucherType, VOUCHER_LABEL, VOUCHER_TYPES, type VoucherType } from "@/lib/accounting";
import { bsToDbText, today } from "@/lib/bs";
import { VoucherForm } from "@/components/accounts/voucher-form";
import { cn } from "@/lib/cn";

export default async function NewVoucherPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; pt?: string; pid?: string }>;
}) {
  const sp = await searchParams;
  const type: VoucherType = isVoucherType(sp.type) ? sp.type : "payment";
  const user = await requirePermission(type === "opening" ? "accounts.setup" : "accounts.post");
  const [accounts, parties] = await Promise.all([listAccounts(false), listPartyChoices()]);
  const canOpen = can(user, "accounts.setup");
  const initialParty = sp.pt && sp.pid ? `p:${sp.pt}:${sp.pid}` : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {VOUCHER_TYPES.filter((t) => t !== "opening" || canOpen).map((t) => (
          <Link
            key={t}
            href={`/accounts/vouchers/new?type=${t}`}
            className={cn(
              "rounded-[999px] border px-3 py-1.5 text-[13px]",
              t === type ? "border-sage-700 bg-sage-700 text-cream-50" : "border-line bg-cream-50 text-sage-700 hover:bg-cream-200",
            )}
          >
            {VOUCHER_LABEL[t]}
          </Link>
        ))}
      </div>
      <h2 className="text-[16px] font-semibold text-sage-900">New {VOUCHER_LABEL[type].toLowerCase()}</h2>
      <VoucherForm
        key={type}
        type={type}
        todayBs={bsToDbText(today())}
        initialParty={initialParty}
        accounts={accounts.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          kind: a.kind,
          grp: a.grp,
          isControl: a.isControl,
          autoOnly: a.autoOnly,
        }))}
        parties={parties}
      />
    </div>
  );
}
