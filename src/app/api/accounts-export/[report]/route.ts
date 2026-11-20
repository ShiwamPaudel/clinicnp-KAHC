import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { can, getRequestUser } from "@/lib/session";
import { accountsAsOf, accountsRange } from "@/lib/accounts-range";
import { accountLines, accountTotals, dayBookLines, dayBefore, DAWN, partyBalanceAt, partyLines } from "@/lib/repos/ledger";
import { agingReport, fiscalYearStartOf, trialBalance } from "@/lib/repos/ledger-reports";
import { getAccount } from "@/lib/repos/accounts";
import { AGING_BUCKETS, isPartyType, PARTY_TYPE_LABEL } from "@/lib/accounting";
import { bsOf, SOURCE_LABEL } from "@/lib/accounts-view";

/** Money as a plain 2-decimal number for spreadsheet cells. */
const rupees = (paisa: number) => Math.round(paisa) / 100;

/**
 * The books as spreadsheets: an account's ledger, a party's statement, the
 * day book, the trial balance and the aging. Needs `accounts.view`.
 */
export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  const user = await getRequestUser();
  if (!user || user.isDoctor || !can(user, "accounts.view")) {
    return NextResponse.json({ ok: false, userMessage: "You don't have permission to do that." }, { status: 403 });
  }
  const { report } = await params;
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const range = accountsRange(sp, "fy");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  let name = report;

  const ledgerColumns = () => {
    ws.columns = [
      { header: "Date (BS)", key: "date", width: 13 },
      { header: "What", key: "what", width: 22 },
      { header: "Number", key: "doc", width: 22 },
      { header: "Detail", key: "detail", width: 40 },
      { header: "Debit", key: "dr", width: 14 },
      { header: "Credit", key: "cr", width: 14 },
      { header: "Balance (Dr +, Cr −)", key: "bal", width: 18 },
    ];
  };

  if (report === "ledger") {
    const account = sp.account ? await getAccount(sp.account) : null;
    if (!account) return NextResponse.json({ ok: false, userMessage: "That account was not found." }, { status: 404 });
    const pandl = account.kind === "income" || account.kind === "expense";
    const openFrom = pandl ? fiscalYearStartOf(range.fromIso) : DAWN;
    const t = openFrom < range.fromIso ? (await accountTotals(openFrom, dayBefore(range.fromIso))).get(account.id) : undefined;
    let bal = t ? t.drPaisa - t.crPaisa : 0;
    ledgerColumns();
    ws.addRow({ date: range.fromBs, what: "Opening balance", bal: rupees(bal) });
    for (const l of await accountLines(account.id, range.fromIso, range.toIso)) {
      bal += l.drPaisa - l.crPaisa;
      ws.addRow({
        date: bsOf(l.dateAd),
        what: SOURCE_LABEL[l.src] ?? l.src,
        doc: l.doc,
        detail: [l.partyName, l.narration].filter(Boolean).join(" · "),
        dr: l.drPaisa ? rupees(l.drPaisa) : null,
        cr: l.crPaisa ? rupees(l.crPaisa) : null,
        bal: rupees(bal),
      });
    }
    name = `ledger-${account.code}`;
  } else if (report === "party") {
    if (!isPartyType(sp.pt) || !sp.pid) return NextResponse.json({ ok: false, userMessage: "That party was not found." }, { status: 404 });
    let bal = await partyBalanceAt(sp.pt, sp.pid, dayBefore(range.fromIso));
    ledgerColumns();
    ws.addRow({ date: range.fromBs, what: "Opening balance", bal: rupees(bal) });
    for (const l of await partyLines(sp.pt, sp.pid, range.fromIso, range.toIso)) {
      bal += l.drPaisa - l.crPaisa;
      ws.addRow({
        date: bsOf(l.dateAd),
        what: SOURCE_LABEL[l.src] ?? l.src,
        doc: l.doc,
        detail: l.narration,
        dr: l.drPaisa ? rupees(l.drPaisa) : null,
        cr: l.crPaisa ? rupees(l.crPaisa) : null,
        bal: rupees(bal),
      });
    }
    name = `statement-${PARTY_TYPE_LABEL[sp.pt].toLowerCase().replace(/\s+/g, "-")}`;
  } else if (report === "daybook") {
    ws.columns = [
      { header: "Date (BS)", key: "date", width: 13 },
      { header: "What", key: "what", width: 22 },
      { header: "Number", key: "doc", width: 22 },
      { header: "Account", key: "account", width: 30 },
      { header: "Person", key: "party", width: 26 },
      { header: "Detail", key: "detail", width: 34 },
      { header: "Debit", key: "dr", width: 14 },
      { header: "Credit", key: "cr", width: 14 },
    ];
    for (const l of await dayBookLines(range.fromIso, range.toIso, 100_000)) {
      ws.addRow({
        date: bsOf(l.dateAd),
        what: SOURCE_LABEL[l.src] ?? l.src,
        doc: l.doc,
        account: l.accountName,
        party: l.partyName,
        detail: l.narration,
        dr: l.drPaisa ? rupees(l.drPaisa) : null,
        cr: l.crPaisa ? rupees(l.crPaisa) : null,
      });
    }
  } else if (report === "trial-balance") {
    const tb = await trialBalance(range.fromIso, range.toIso);
    ws.columns = [
      { header: "Code", key: "code", width: 8 },
      { header: "Account", key: "name", width: 34 },
      { header: "Opening Dr", key: "od", width: 14 },
      { header: "Opening Cr", key: "oc", width: 14 },
      { header: "Debit", key: "dr", width: 14 },
      { header: "Credit", key: "cr", width: 14 },
      { header: "Closing Dr", key: "cd", width: 14 },
      { header: "Closing Cr", key: "cc", width: 14 },
    ];
    for (const r of tb.rows) {
      ws.addRow({
        code: r.account.code,
        name: r.account.name,
        od: r.openingPaisa > 0 ? rupees(r.openingPaisa) : null,
        oc: r.openingPaisa < 0 ? rupees(-r.openingPaisa) : null,
        dr: rupees(r.drPaisa),
        cr: rupees(r.crPaisa),
        cd: r.closingPaisa > 0 ? rupees(r.closingPaisa) : null,
        cc: r.closingPaisa < 0 ? rupees(-r.closingPaisa) : null,
      });
    }
    if (tb.earlierProfitPaisa !== 0) {
      const e = tb.earlierProfitPaisa;
      ws.addRow({ name: "Profit of earlier years", od: e < 0 ? rupees(-e) : null, oc: e > 0 ? rupees(e) : null, cd: e < 0 ? rupees(-e) : null, cc: e > 0 ? rupees(e) : null }); // sweep-ok: cell values, not words
    }
    const t = tb.totals;
    ws.addRow({ name: "Total", od: rupees(t.openingDr), oc: rupees(t.openingCr), dr: rupees(t.dr), cr: rupees(t.cr), cd: rupees(t.closingDr), cc: rupees(t.closingCr) });
  } else if (report === "aging") {
    const side = sp.side === "payable" ? "payable" : "receivable";
    const asOf = accountsAsOf(sp);
    const r = await agingReport(side, asOf.iso);
    ws.columns = [
      { header: "Name", key: "name", width: 32 },
      { header: "Kind", key: "kind", width: 18 },
      { header: "Oldest bill (BS)", key: "oldest", width: 15 },
      ...AGING_BUCKETS.map((b) => ({ header: b.label, key: b.key, width: 14 })),
      { header: "Total", key: "total", width: 14 },
    ];
    for (const row of r.rows) {
      ws.addRow({
        name: row.name,
        kind: PARTY_TYPE_LABEL[row.partyType],
        oldest: row.oldestDateAd ? bsOf(row.oldestDateAd) : "",
        ...Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, rupees(row.buckets[b.key])])),
        total: rupees(row.openPaisa),
      });
    }
    ws.addRow({ name: "Total", ...Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, rupees(r.totals[b.key])])), total: rupees(r.totalOpenPaisa) });
    name = `aging-${side}-${asOf.iso}`;
  } else {
    return NextResponse.json({ ok: false, userMessage: "That report was not found." }, { status: 404 });
  }

  ws.getRow(1).font = { bold: true };
  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}-${range.fromIso}_${range.toIso}.xlsx"`,
    },
  });
}
