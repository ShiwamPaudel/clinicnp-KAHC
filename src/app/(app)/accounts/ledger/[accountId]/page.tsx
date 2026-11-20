import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { getAccount } from "@/lib/repos/accounts";
import { accountLines, accountTotals, DAWN, dayBefore } from "@/lib/repos/ledger";
import { fiscalYearStartOf } from "@/lib/repos/ledger-reports";
import { accountsRange } from "@/lib/accounts-range";
import { amountOrBlank, bsOf, drCr, partyHref, SOURCE_LABEL } from "@/lib/accounts-view";
import { ACCOUNT_GROUPS } from "@/lib/accounting";
import { formatPaisa } from "@/lib/money";
import { RangeBar } from "@/components/accounts/range-bar";
import { Statement } from "@/components/accounts/statement";
import { ExportLink } from "@/components/accounts/export-link";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";

export default async function AccountLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  await requirePermission("accounts.view");
  const { accountId: raw } = await params;
  const accountId = decodeURIComponent(raw);
  const account = await getAccount(accountId);
  if (!account) notFound();
  const sp = await searchParams;
  const range = accountsRange(sp);

  // Income and expenses start again each fiscal year; everything else carries on.
  const pandl = account.kind === "income" || account.kind === "expense";
  const openFrom = pandl ? fiscalYearStartOf(range.fromIso) : DAWN;
  const before = openFrom < range.fromIso ? (await accountTotals(openFrom, dayBefore(range.fromIso))).get(account.id) : undefined;
  const opening = before ? before.drPaisa - before.crPaisa : 0;
  const lines = await accountLines(account.id, range.fromIso, range.toIso);
  let running = opening;
  const rows = lines.map((l) => {
    running += l.drPaisa - l.crPaisa;
    return { ...l, running };
  });
  const dr = lines.reduce((s, l) => s + l.drPaisa, 0);
  const cr = lines.reduce((s, l) => s + l.crPaisa, 0);
  const title = account.grp === "cash_bank" ? `${account.name} — cash and bank book` : `${account.name} — ledger`;

  return (
    <Statement
      title={title}
      actions={<ExportLink report="ledger" extra={{ account: account.id }} />}
      period={range.label}
      controls={<RangeBar preset={range.preset} fromBs={range.fromBs} toBs={range.toBs} label={range.label} />}
    >
      <p className="mb-3 text-[13px] text-sage-500">
        {account.code} · {ACCOUNT_GROUPS[account.grp]?.label ?? account.grp}
        {account.isControl && " · each person's share is under Parties"}
      </p>
      <Table>
        <THead>
          <TR>
            <TH>Date</TH>
            <TH>What</TH>
            <TH>Detail</TH>
            <TH numeric>Debit</TH>
            <TH numeric>Credit</TH>
            <TH numeric>Balance</TH>
          </TR>
        </THead>
        <tbody>
          <TR className="bg-cream-100">
            <TD>{range.fromBs}</TD>
            <TD className="font-medium">Opening balance</TD>
            <TD> </TD>
            <TD numeric> </TD>
            <TD numeric> </TD>
            <TD numeric className="font-medium">{drCr(opening)}</TD>
          </TR>
          {rows.map((l, i) => (
            <TR key={i}>
              <TD className="whitespace-nowrap">{bsOf(l.dateAd)}</TD>
              <TD className="whitespace-nowrap">
                <Link href={l.link} className="text-sage-700 hover:underline">
                  {SOURCE_LABEL[l.src] ?? l.src}
                  {l.doc && <span className="ml-1 text-[12px] text-sage-500">{l.doc}</span>}
                </Link>
              </TD>
              <TD className="text-[13px] text-sage-600">
                {l.partyType && l.partyId !== null && (
                  <Link href={partyHref(l.partyType, l.partyId)} className="mr-1 font-medium text-sage-900 hover:underline">
                    {l.partyName || "No name"} ·
                  </Link>
                )}
                {l.narration}
              </TD>
              <TD numeric>{amountOrBlank(l.drPaisa)}</TD>
              <TD numeric>{amountOrBlank(l.crPaisa)}</TD>
              <TD numeric>{drCr(l.running)}</TD>
            </TR>
          ))}
          <TR className="bg-sage-75 font-semibold">
            <TD> </TD>
            <TD>Closing balance</TD>
            <TD> </TD>
            <TD numeric>{formatPaisa(dr, false)}</TD>
            <TD numeric>{formatPaisa(cr, false)}</TD>
            <TD numeric>{drCr(running)}</TD>
          </TR>
        </tbody>
      </Table>
    </Statement>
  );
}
