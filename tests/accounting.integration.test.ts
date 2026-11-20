/**
 * The books (0025, prod-docs/Accounting.md), on a file DB, through the real
 * code that writes each document: a purchase, bills paid in cash and on
 * dues, a dues payment and one undone, a return, a cancelled bill, a supplier
 * payment, a stock out, and vouchers entered by hand.
 *
 * What must hold: every document balances, the whole book balances, and each
 * control account says what the screen it shadows says.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { readFileSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ulid } from "ulid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, `accounts.${process.pid}-${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;
process.env.TURSO_AUTH_TOKEN = "";

const TODAY_AD = "2026-11-19";
const TODAY_BS = "2083-08-03";
const ALL = { from: "0001-01-01", to: "9999-12-31" };

function splitStatements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${DB_FILE}${suffix}`, { force: true });
    } catch {
      /* a lingering handle on Windows */
    }
  }
});

const ITEM = "item1";
let supplierId = "";
let patientId = "";
let cashBillId = "";
let cashBillLineId = "";
let creditBillId = "";
let rentVoucherId = "";
let bankId = "";

async function bill(opts: {
  method: "cash" | "qr" | "credit";
  paidNow?: number;
  tablets?: number;
  services?: { id: string; rate: number; doctorId?: string | null; labPartnerId?: string | null }[];
  discount?: number;
  patientId?: string | null;
}) {
  const { ingestBill } = await import("@/lib/repos/bills");
  const lineId = ulid();
  const res = await ingestBill({
    id: ulid(),
    dateBs: TODAY_BS,
    dateAd: TODAY_AD,
    patientName: "",
    paymentMethod: opts.method,
    tenderedPaisa: 0,
    paidNowPaisa: opts.method === "credit" ? (opts.paidNow ?? 0) : undefined,
    paidNowMethod: "cash",
    billDiscountPaisa: opts.discount ?? 0,
    lines: opts.tablets
      ? [{ id: lineId, itemId: ITEM, unitLevel: 0, qty: opts.tablets, ratePaisa: 200, rateOverridden: false, discountPaisa: 0 }]
      : [],
    serviceLines: (opts.services ?? []).map((s) => ({
      id: ulid(),
      serviceId: s.id,
      qty: 1,
      ratePaisa: s.rate,
      rateOverridden: false,
      discountPaisa: 0,
      doctorId: s.doctorId ?? null,
      labPartnerId: s.labPartnerId ?? null,
      followupApplied: false,
    })),
    patientId: opts.patientId ?? null,
    userId: "u1",
    clientCreatedAt: new Date().toISOString(),
  });
  return { id: res.id, lineId };
}

beforeAll(async () => {
  const { __resetDbForTests } = await import("@/lib/db");
  __resetDbForTests();
  const raw = createClient({ url: `file:${DB_FILE}` });
  const migDir = join(__dirname, "..", "db", "migrations");
  for (const f of readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()) {
    for (const stmt of splitStatements(readFileSync(join(migDir, f), "utf8"))) await raw.execute(stmt);
  }
  await raw.execute("INSERT INTO users (id, name, username, password_hash, role_id, created_at) VALUES ('u1','Anita','anita','x','accountant','t')");
  await raw.execute("INSERT INTO company (id, name, module_clinic, module_lab, updated_at) VALUES (1, 'Books Check', 1, 1, 't')");
  await raw.execute("INSERT INTO fiscal_years (bs_label, start_ad, end_ad, active, status) VALUES ('2083/84','2026-07-17','2027-07-16',1,'open')");
  await raw.execute("INSERT INTO doctors (id, name, share_basis, share_value, active, created_at, updated_at) VALUES ('doc1','Dr. Sample Karki','pct_consult',4000,1,'t','t')");
  await raw.execute("INSERT INTO lab_partners (id, name, active, created_at, updated_at) VALUES ('lab1','Sample Path Lab',1,'t','t')");
  await raw.execute(
    `INSERT INTO services (id, name, group_id, rate_paisa, doctor_required, active, created_at, updated_at)
     VALUES ('svc_opd','OPD Consultation','grp_opd',50000,1,1,'t','t')`,
  );
  await raw.execute(
    `INSERT INTO services (id, name, group_id, rate_paisa, outsourced, default_lab_partner_id, partner_cost_paisa, active, created_at, updated_at)
     VALUES ('svc_cbc','CBC (sent out)','grp_lab',60000,1,'lab1',40000,1,'t','t')`,
  );
  await raw.execute(
    `INSERT INTO items (id, brand_name, generic_name, category, controlled_flag, shape, active, created_at, updated_at)
     VALUES ('${ITEM}', 'Cetamol', 'Paracetamol 500', 'Medicine', 0, 'tablet', 1, 't', 't')`,
  );
  await raw.execute(
    `INSERT INTO item_units (id, item_id, level, name, factor_to_base, selling_rate_paisa, is_default_selling)
     VALUES ('${ulid()}', '${ITEM}', 0, 'Tablet', 1, 200, 1)`,
  );
  raw.close();

  const { createSupplier } = await import("@/lib/repos/suppliers");
  supplierId = await createSupplier({ name: "Sample Pharma Distributors", panNo: "", phone: "", address: "", contactPerson: "", terms: "", active: true });
  const { createPatient } = await import("@/lib/repos/patients");
  patientId = (
    await createPatient({ name: "Anita Shrestha", sex: "f", ageValue: 34, ageUnit: "y", ageAsOfAd: TODAY_AD, dobAd: null, phone: "", address: "", userId: "u1" })
  ).id;

  // 100 tablets at Re 1, Rs 5 off the bill: owed Rs 95.
  const { createPurchase } = await import("@/lib/repos/purchases");
  await createPurchase({
    supplierId,
    supplierInvoiceNo: "INV-1",
    dateAd: TODAY_AD,
    dateBs: TODAY_BS,
    vatPaisa: 0,
    billDiscountPaisa: 500,
    roundingPaisa: 0,
    lines: [
      { itemId: ITEM, batchNo: "B1", mfgDateAd: null, expiryDateAd: "2029-01-01", unitLevel: 0, factorToBase: 1, qty: 100, freeQty: 0, unitCostPaisa: 100, discountPaisa: 0 },
    ],
    userId: "u1",
  });

  // Cash: 10 tablets (Rs 20) and a consultation (Rs 500, doctor 40%), Rs 10 off.
  const b1 = await bill({ method: "cash", tablets: 10, services: [{ id: "svc_opd", rate: 50000, doctorId: "doc1" }], discount: 1000, patientId });
  cashBillId = b1.id;
  cashBillLineId = b1.lineId;

  // On dues: a sent-out CBC (Rs 600, lab charges Rs 400), Rs 100 paid now.
  creditBillId = (await bill({ method: "credit", paidNow: 10000, services: [{ id: "svc_cbc", rate: 60000, labPartnerId: "lab1" }], patientId })).id;

  const { receiveDuePayment, voidDueReceipt } = await import("@/lib/repos/dues");
  await receiveDuePayment({ receiptId: ulid(), billIds: [creditBillId], amountPaisa: 20000, method: "qr", note: "", dateAd: TODAY_AD, dateBs: TODAY_BS, userId: "u1" });
  const wrong = ulid();
  await receiveDuePayment({ receiptId: wrong, billIds: [creditBillId], amountPaisa: 5000, method: "cash", note: "", dateAd: TODAY_AD, dateBs: TODAY_BS, userId: "u1" });
  await voidDueReceipt(wrong, "u1");

  // 5 tablets back from the cash bill: Rs 10 handed back.
  const { createSaleReturn } = await import("@/lib/repos/sale-returns");
  await createSaleReturn({
    billId: cashBillId,
    dateAd: TODAY_AD,
    dateBs: TODAY_BS,
    lines: [{ billLineId: cashBillLineId, itemId: ITEM, returnBaseQty: 5, amountPaisa: 1000 }],
    userId: "u1",
  });

  // A bill made and cancelled.
  const b3 = await bill({ method: "cash", tablets: 5 });
  const { cancelBill } = await import("@/lib/repos/bills");
  await cancelBill(b3.id, "u1");

  // Rs 50 paid to the supplier by bank, no bank chosen.
  const { recordSupplierPayment } = await import("@/lib/repos/suppliers");
  await recordSupplierPayment({ supplierId, dateAd: TODAY_AD, dateBs: TODAY_BS, amountPaisa: 5000, method: "bank", note: "", userId: "u1" });

  // 2 tablets damaged.
  const { db } = await import("@/lib/db");
  const batch = (await db().execute("SELECT id FROM batches LIMIT 1")).rows[0]!.id as string;
  const { createStockOut } = await import("@/lib/repos/adjustments");
  await createStockOut({
    direction: "out",
    reason: "damaged",
    dateAd: TODAY_AD,
    dateBs: TODAY_BS,
    lines: [{ itemId: ITEM, batchId: batch, baseQty: 2, unitLevelEntered: 0, qtyEntered: 2 }],
    userId: "u1",
  });

  // By hand: a bank account, an opening (cash Rs 100, an old supplier bill of
  // Rs 20), rent Rs 30 paid in cash and then cancelled, Rs 40 banked.
  const { saveAccount, createVoucher } = await import("@/lib/repos/accounts");
  bankId = await saveAccount({ code: "1020", name: "Sample Bank", grp: "cash_bank", isBank: true, segment: null, note: "", active: true });
  await createVoucher({
    type: "opening",
    dateAd: TODAY_AD,
    dateBs: TODAY_BS,
    narration: "Balances brought in",
    lines: [
      { accountId: "sys:cash", partyType: null, partyId: null, debitPaisa: 10000, creditPaisa: 0 },
      { accountId: "sys:pay_suppliers", partyType: "supplier", partyId: supplierId, debitPaisa: 0, creditPaisa: 2000, refNo: "OLD-7", refDateAd: "2026-08-01", refDateBs: "2083-04-16" },
    ],
    userId: "u1",
  });
  rentVoucherId = (
    await createVoucher({
      type: "payment",
      dateAd: TODAY_AD,
      dateBs: TODAY_BS,
      narration: "Rent",
      lines: [
        { accountId: "acc:rent", partyType: null, partyId: null, debitPaisa: 3000, creditPaisa: 0 },
        { accountId: "sys:cash", partyType: null, partyId: null, debitPaisa: 0, creditPaisa: 3000 },
      ],
      userId: "u1",
    })
  ).id;
  await createVoucher({
    type: "contra",
    dateAd: TODAY_AD,
    dateBs: TODAY_BS,
    narration: "Banked",
    lines: [
      { accountId: bankId, partyType: null, partyId: null, debitPaisa: 4000, creditPaisa: 0 },
      { accountId: "sys:cash", partyType: null, partyId: null, debitPaisa: 0, creditPaisa: 4000 },
    ],
    userId: "u1",
  });
  const { cancelVoucher } = await import("@/lib/repos/accounts");
  await cancelVoucher({ id: rentVoucherId, dateAd: TODAY_AD, dateBs: TODAY_BS, reason: "Entered twice", userId: "u1" });
});

async function balances() {
  const { accountTotals } = await import("@/lib/repos/ledger");
  const t = await accountTotals(ALL.from, ALL.to);
  const bal = (id: string) => (t.get(id)?.drPaisa ?? 0) - (t.get(id)?.crPaisa ?? 0);
  return { t, bal };
}

describe("the books", () => {
  it("balance: every document, and the whole book", async () => {
    const { db } = await import("@/lib/db");
    const { JOURNAL_SQL } = await import("@/lib/repos/ledger");
    const docs = await db().execute({
      sql: `SELECT src, src_id, SUM(dr) AS dr, SUM(cr) AS cr FROM (${JOURNAL_SQL}) GROUP BY src, src_id`,
      args: ALL,
    });
    expect(docs.rows.length).toBeGreaterThan(8);
    for (const d of docs.rows) expect([d.src, Number(d.dr)]).toEqual([d.src, Number(d.cr)]);
  });

  it("post the cash bill: sales by part, the discount shared, cost at batch cost, the doctor's share", async () => {
    const { db } = await import("@/lib/db");
    const { JOURNAL_SQL } = await import("@/lib/repos/ledger");
    const res = await db().execute({
      sql: `SELECT account_id, segment, dr, cr FROM (${JOURNAL_SQL}) WHERE src = 'bill' AND src_id = :id ORDER BY account_id, segment`,
      args: { ...ALL, id: cashBillId },
    });
    const lines = res.rows.map((r) => [r.account_id, r.segment, Number(r.dr), Number(r.cr)]);
    expect(lines).toEqual([
      ["sys:cash", null, 51000, 0],
      ["sys:cogs", "pharmacy", 1000, 0],
      // Rs 10 off Rs 520: the medicines' Rs 20 carries 38 paisa of it
      ["sys:discount_allowed", "clinic", 962, 0],
      ["sys:discount_allowed", "pharmacy", 38, 0],
      ["sys:doctor_share", "clinic", 20000, 0],
      ["sys:income_clinic", "clinic", 0, 50000],
      ["sys:pay_doctors", null, 0, 20000],
      ["sys:sales_pharmacy", "pharmacy", 0, 2000],
      ["sys:stock", "pharmacy", 0, 1000],
    ]);
  });

  it("agree with the Dues list, the supplier's page, the laboratory and the shelf", async () => {
    const { bal } = await balances();
    const { duesTotals } = await import("@/lib/repos/dues");
    expect(bal("sys:recv_patients")).toBe((await duesTotals()).owedPaisa);
    expect(bal("sys:recv_patients")).toBe(30000);

    const { supplierBalance } = await import("@/lib/repos/suppliers");
    // purchase 9,500 + opening 2,000 − paid 5,000
    expect(await supplierBalance(supplierId)).toBe(6500);
    expect(-bal("sys:pay_suppliers")).toBe(6500);

    const { partnerBalancePaisa } = await import("@/lib/repos/lab-partners");
    expect(await partnerBalancePaisa("lab1")).toBe(40000);
    expect(-bal("sys:pay_labs")).toBe(40000);
    expect(-bal("sys:pay_doctors")).toBe(20000);

    const { db } = await import("@/lib/db");
    const shelf = Number(
      (await db().execute("SELECT SUM(remaining_base_qty * purchase_cost_paisa_per_base) AS v FROM batches")).rows[0]!.v,
    );
    // 100 bought, 10 sold, 5 back, 5 sold and cancelled, 2 damaged: 93 at Re 1
    expect(shelf).toBe(9300);
    expect(bal("sys:stock")).toBe(9300);
  });

  it("keep cash, QR and bank honest", async () => {
    const { bal } = await balances();
    // 510 bill − 10 handed back + 100 paid now on dues + 100 opening − 40 banked
    // (the rent was cancelled, the wrong dues payment undone, the cancelled bill reversed)
    expect(bal("sys:cash")).toBe(51000 - 1000 + 10000 + 10000 - 4000);
    expect(bal("sys:qr")).toBe(20000);
    expect(bal("sys:bank_unassigned")).toBe(-5000);
    expect(bal(bankId)).toBe(4000);
    expect(bal("acc:rent")).toBe(0);
    expect(bal("sys:opening")).toBe(-8000);
  });

  it("show the party ledger and the aging oldest first, from the bill date", async () => {
    const { partyMovements } = await import("@/lib/repos/ledger");
    const { openItemsOldestFirst, ageItems } = await import("@/lib/accounting");
    const moves = await partyMovements("payable", ["supplier"], "9999-12-31");
    const s = moves.get(`supplier:${supplierId}`)!;
    const { items, advancePaisa } = openItemsOldestFirst(s.moves);
    // the Rs 50 payment clears the old Rs 20 bill first, then Rs 30 of the new one
    expect(items.map((i) => [i.ref, i.openPaisa])).toEqual([[expect.stringMatching(/^PI-/), 6500]]);
    expect(advancePaisa).toBe(0);
    const aged = ageItems([{ dateAd: "2026-08-01", openPaisa: 2000 }], TODAY_AD);
    expect(aged.d91).toBe(2000);
  });

  it("refuse a voucher in a closed year, and one that touches stock by hand", async () => {
    const { createVoucher } = await import("@/lib/repos/accounts");
    await expect(
      createVoucher({
        type: "journal",
        dateAd: TODAY_AD,
        dateBs: TODAY_BS,
        narration: "",
        lines: [
          { accountId: "sys:stock", partyType: null, partyId: null, debitPaisa: 100, creditPaisa: 0 },
          { accountId: "sys:cash", partyType: null, partyId: null, debitPaisa: 0, creditPaisa: 100 },
        ],
        userId: "u1",
      }),
    ).rejects.toThrow(/Medicine stock/);
    await expect(
      createVoucher({
        type: "payment",
        dateAd: "2026-01-01",
        dateBs: "2082-09-17",
        narration: "",
        lines: [
          { accountId: "acc:rent", partyType: null, partyId: null, debitPaisa: 100, creditPaisa: 0 },
          { accountId: "sys:cash", partyType: null, partyId: null, debitPaisa: 0, creditPaisa: 100 },
        ],
        userId: "u1",
      }),
    ).rejects.toThrow(/outside every fiscal year/);
  });

  it("number vouchers per type per year", async () => {
    const { listVouchers } = await import("@/lib/repos/accounts");
    const v = await listVouchers(ALL.from, ALL.to, null);
    expect(v.map((x) => x.voucherNo).sort()).toEqual(["CV-2083/84-0001", "OB-2083/84-0001", "PV-2083/84-0001"]);
    expect(v.find((x) => x.type === "payment")!.status).toBe("cancelled");
  });
});
