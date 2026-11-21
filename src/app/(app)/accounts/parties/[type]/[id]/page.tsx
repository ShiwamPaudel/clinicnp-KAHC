import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/session";
import { partyLines, partyBalanceAt, partyMovements, dayBefore, partyDisplayName } from "@/lib/repos/ledger";
import { listDuePeople } from "@/lib/repos/dues";
import { accountsRange, accountsAsOf } from "@/lib/accounts-range";
import { ageItems, AGING_BUCKETS, isPartyType, openItemsOldestFirst, PARTY_TYPE_LABEL, type PartyType } from "@/lib/accounting";
import { amountOrBlank, bsOf, drCr, SOURCE_LABEL } from "@/lib/accounts-view";
import { formatPaisa } from "@/lib/money";
import { RangeBar } from "@/components/accounts/range-bar";
import { Statement } from "@/components/accounts/statement";
import { ExportLink } from "@/components/accounts/export-link";
import { Table, THead, TR, TH, TD } from "@/components/ui/table";
import { formatDocNo } from "@/lib/invoice-number";

/** Where money with this party is actually recorded. */
function payHere(type: PartyType, id: string): { href: string; label: string } | null {
  switch (type) {
    case "patient":
    case "walkin":
      return { href: "/dues", label: "Take payment on the Dues list" };
    case "supplier":
      return { href: `/suppliers/${id}`, label: "Pay on the supplier's page" };
    case "lab_partner":
      return { href: `/reports/lab-partners?partner=${id}`, label: "Pay on the laboratory's statement" };
    case "doctor":
    case "party":
      return { href: `/accounts/vouchers/new?type=payment&pt=${type}&pid=${encodeURIComponent(id)}`, label: "Record a payment" };
  }
}

export default async function PartyStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ type: string; id: string }>;
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const user = await requirePermission("accounts.view");
  const p = await params;
  if (!isPartyType(p.type)) notFound();
  const type = p.type;
  const id = decodeURIComponent(p.id);
  const name = await partyDisplayName(type, id);
  if (name === null) notFound();
  const range = accountsRange(await searchParams, "fy");
  const today = accountsAsOf({});

  const opening = await partyBalanceAt(type, id, dayBefore(range.fromIso));
  const lines = await partyLines(type, id, range.fromIso, range.toIso);
  let running = opening;
  const rows = lines.map((l) => {
    running += l.drPaisa - l.crPaisa;
    return { ...l, running };
  });

  // What is open today, and how old.
  let open: { dateAd: string; ref: string; openPaisa: number }[] = [];
  let advance = 0;
  if (type === "patient" || type === "walkin") {
    const person = (await listDuePeople(today.iso)).find((x) => (type === "patient" ? x.patientId === id : !x.patientId && x.name.trim() === id));
    open = (person?.bills ?? []).map((b) => ({ dateAd: b.dateAd, ref: b.invoiceNo ? `Bill ${formatDocNo("SI", b.fiscalLabel, b.invoiceNo)}` : "Bill", openPaisa: b.balancePaisa }));
  } else {
    const receivable = type === "party" && (await partyBalanceAt(type, id, today.iso)) > 0;
    const m = (await partyMovements(receivable ? "receivable" : "payable", [type], today.iso)).get(`${type}:${id}`);
    if (m) {
      const r = openItemsOldestFirst(m.moves);
      open = r.items;
      advance = r.advancePaisa;
    }
  }
  const aged = ageItems(open, today.iso);
  const pay = can(user, ["accounts.post", "dues.collect", "suppliers.manage", "reports.all"]) ? payHere(type, id) : null;

  return (
    <Statement
      title={`${name || "No name"} — statement`}
      period={range.label}
      controls={<RangeBar preset={range.preset} fromBs={range.fromBs} toBs={range.toBs} label={range.label} />}
      actions={
        <>
          <ExportLink report="party" extra={{ pt: type, pid: id }} />
          {pay && (
            <Link href={pay.href} className="inline-flex h-10 items-center rounded-[8px] bg-sage-700 px-4 text-[14px] font-medium text-cream-50 hover:bg-sage-600">
              {pay.label}
            </Link>
          )}
        </>
      }
    >
      <p className="mb-3 text-[13px] text-sage-500">
        {PARTY_TYPE_LABEL[type]} 
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
              <TD className="text-[13px] text-sage-600">{l.narration}</TD>
              <TD numeric>{amountOrBlank(l.drPaisa)}</TD>
              <TD numeric>{amountOrBlank(l.crPaisa)}</TD>
              <TD numeric>{drCr(l.running)}</TD>
            </TR>
          ))}
          <TR className="bg-sage-75 font-semibold">
            <TD> </TD>
            <TD>Closing balance</TD>
            <TD> </TD>
            <TD numeric>{formatPaisa(lines.reduce((s, l) => s + l.drPaisa, 0), false)}</TD>
            <TD numeric>{formatPaisa(lines.reduce((s, l) => s + l.crPaisa, 0), false)}</TD>
            <TD numeric>{drCr(running)}</TD>
          </TR>
        </tbody>
      </Table>

      <h3 className="mb-2 mt-6 text-[14px] font-semibold text-sage-900">Open bills today, by age</h3>
      {open.length === 0 ? (
        <p className="text-[13px] text-sage-500">
          Nothing is open.{advance !== 0 && ` ${formatPaisa(Math.abs(advance))} has been paid ahead.`}
        </p>
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Bill</TH>
                <TH>Date</TH>
                <TH numeric>Days</TH>
                <TH numeric>Still open</TH>
              </TR>
            </THead>
            <tbody>
              {open.map((o, i) => (
                <TR key={i}>
                  <TD>{o.ref}</TD>
                  <TD>{bsOf(o.dateAd)}</TD>
                  <TD numeric>{Math.max(0, Math.round((Date.parse(today.iso) - Date.parse(o.dateAd)) / 86_400_000))}</TD>
                  <TD numeric>{formatPaisa(o.openPaisa, false)}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {AGING_BUCKETS.map((b) => (
              <div key={b.key} className="rounded-[8px] border border-line bg-cream-50 px-3 py-2">
                <div className="text-[12px] text-sage-500">{b.label}</div>
                <div className="font-semibold tnum">{formatPaisa(aged[b.key], false)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </Statement>
  );
}
