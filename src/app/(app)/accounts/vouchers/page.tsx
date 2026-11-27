import Link from "next/link";
import { Plus, ReceiptText } from "lucide-react";
import { requirePermission, can } from "@/lib/session";
import { listVouchers } from "@/lib/repos/accounts";
import { accountsRange } from "@/lib/accounts-range";
import { isVoucherType, VOUCHER_LABEL, VOUCHER_TYPES } from "@/lib/accounting";
import { formatPaisa } from "@/lib/money";
import { RangeBar } from "@/components/accounts/range-bar";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

export default async function VouchersPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string; type?: string }>;
}) {
  const user = await requirePermission(["accounts.view", "accounts.post"]);
  const sp = await searchParams;
  const range = accountsRange(sp, "fy");
  const type = isVoucherType(sp.type) ? sp.type : null;
  const rows = await listVouchers(range.fromIso, range.toIso, type);
  const keep = (t: string | null) => {
    const q = new URLSearchParams();
    if (sp.preset) q.set("preset", sp.preset);
    if (sp.from && sp.to) {
      q.set("from", sp.from);
      q.set("to", sp.to);
    }
    if (t) q.set("type", t);
    const s = q.toString();
    return `/accounts/vouchers${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <RangeBar preset={range.preset} fromBs={range.fromBs} toBs={range.toBs} label={range.label} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {[null, ...VOUCHER_TYPES].map((t) => (
            <Link
              key={t ?? "all"}
              href={keep(t)}
              className={cn(
                "rounded-[999px] border px-3 py-1.5 text-[13px]",
                type === t ? "border-sage-700 bg-sage-700 text-cream-50" : "border-line bg-cream-50 text-sage-700 hover:bg-cream-200",
              )}
            >
              {t ? VOUCHER_LABEL[t] : "All"}
            </Link>
          ))}
        </div>
        {can(user, "accounts.post") && (
          <Link
            href={`/accounts/vouchers/new?type=${type && type !== "opening" ? type : "payment"}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-[8px] bg-sage-700 px-4 text-[14px] font-medium text-cream-50 hover:bg-sage-600"
          >
            <Plus className="h-4 w-4" /> New entry
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={ReceiptText} message="No entries in this period. Bills, purchases and payments go into the books by themselves." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Number</TH>
              <TH>Date</TH>
              <TH>Type</TH>
              <TH>Accounts and people</TH>
              <TH>Description</TH>
              <TH numeric>Amount</TH>
            </TR>
          </THead>
          <tbody>
            {rows.map((v) => (
              <TR key={v.id}>
                <TD className="whitespace-nowrap">
                  <Link href={`/accounts/vouchers/${v.id}`} className="font-medium text-sage-900 hover:underline tnum">
                    {v.voucherNo}
                  </Link>
                  {v.status === "cancelled" && (
                    <Badge tone="danger" className="ml-2">
                      Cancelled
                    </Badge>
                  )}
                </TD>
                <TD className="whitespace-nowrap">{v.dateBs}</TD>
                <TD>{VOUCHER_LABEL[v.type]}</TD>
                <TD className="text-[13px] text-sage-600">{v.summary}</TD>
                <TD className="text-[13px] text-sage-600">{v.narration}</TD>
                <TD numeric className={cn(v.status === "cancelled" && "text-sage-500 line-through")}>
                  {formatPaisa(v.totalPaisa, false)}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
