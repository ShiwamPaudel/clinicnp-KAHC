import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission, can } from "@/lib/session";
import { getVoucher } from "@/lib/repos/accounts";
import { VOUCHER_LABEL } from "@/lib/accounting";
import { amountOrBlank, partyHref } from "@/lib/accounts-view";
import { formatPaisa } from "@/lib/money";
import { Statement } from "@/components/accounts/statement";
import { CancelVoucher } from "@/components/accounts/cancel-voucher";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export default async function VoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission(["accounts.view", "accounts.post"]);
  const { id } = await params;
  const v = await getVoucher(id);
  if (!v) notFound();
  const dr = v.lines.reduce((s, l) => s + l.debitPaisa, 0);
  const cr = v.lines.reduce((s, l) => s + l.creditPaisa, 0);
  const canCancel = v.status === "posted" && v.fiscalStatus === "open" && can(user, "accounts.post");

  return (
    <>
      <Link href="/accounts/vouchers" className="no-print mb-3 inline-flex items-center gap-1.5 text-[13px] text-sage-500 hover:text-sage-700">
        <ArrowLeft className="h-4 w-4" /> All vouchers
      </Link>
      <Statement
        title={`${VOUCHER_LABEL[v.type]} ${v.voucherNo}`}
        period={`Date ${v.dateBs}`}
        actions={canCancel ? <CancelVoucher id={v.id} /> : null}
      >
        <div className="mb-3 flex flex-wrap items-center gap-3 text-[14px] text-sage-700">
          <span>
            Date <span className="font-medium tnum">{v.dateBs}</span>
          </span>
          {v.userName && <span>Entered by {v.userName}</span>}
          {v.status === "cancelled" && <Badge tone="danger">Cancelled on {v.cancelDateBs}</Badge>}
        </div>
        {v.status === "cancelled" && (
          <p className="mb-3 rounded-[8px] bg-danger-100 px-3 py-2 text-[13px] text-danger-600">
            Cancelled by {v.cancelledByName || "someone"}: {v.cancelReason}. It was reversed on {v.cancelDateBs}; the original
            stays on {v.dateBs}.
          </p>
        )}
        <Table>
          <THead>
            <TR>
              <TH>Account</TH>
              <TH>Person</TH>
              <TH>Note</TH>
              <TH numeric>Debit</TH>
              <TH numeric>Credit</TH>
            </TR>
          </THead>
          <tbody>
            {v.lines.map((l, i) => (
              <TR key={i}>
                <TD>
                  <Link href={`/accounts/ledger/${encodeURIComponent(l.accountId)}`} className="hover:underline">
                    <span className="mr-2 text-[12px] text-sage-500 tnum">{l.accountCode}</span>
                    {l.accountName}
                  </Link>
                </TD>
                <TD>
                  {l.partyType && l.partyId ? (
                    <Link href={partyHref(l.partyType, l.partyId)} className="hover:underline">
                      {l.partyName}
                    </Link>
                  ) : null}
                </TD>
                <TD className="text-[13px] text-sage-600">
                  {l.refNo ? `Bill ${l.refNo}${l.refDateBs ? ` of ${l.refDateBs}` : ""}` : ""}
                  {l.refNo && l.note ? " · " : ""}
                  {l.note}
                </TD>
                <TD numeric>{amountOrBlank(l.debitPaisa)}</TD>
                <TD numeric>{amountOrBlank(l.creditPaisa)}</TD>
              </TR>
            ))}
            <TR className="bg-sage-75 font-semibold">
              <TD>Total</TD>
              <TD> </TD>
              <TD> </TD>
              <TD numeric>{formatPaisa(dr, false)}</TD>
              <TD numeric>{formatPaisa(cr, false)}</TD>
            </TR>
          </tbody>
        </Table>
        {v.narration && <p className="mt-3 text-[14px] text-sage-700">Narration: {v.narration}</p>}
        <div className="print-only mt-16 grid grid-cols-3 gap-8 text-center text-[11px]">
          <div className="border-t border-black pt-1">Prepared by</div>
          <div className="border-t border-black pt-1">Checked by</div>
          <div className="border-t border-black pt-1">Approved by</div>
        </div>
      </Statement>
    </>
  );
}
