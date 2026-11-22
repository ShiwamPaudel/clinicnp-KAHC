/**
 * Fund transfer charges and delivery (0030): the bank's or wallet's fee on a
 * payment is the clinic's own expense, paid from the same money, and never
 * changes what the supplier or laboratory is owed. Delivery to a courier is a
 * payment voucher (Miscellaneous expenses) that names the purchase.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { readFileSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, `charges.${process.pid}-${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;
process.env.TURSO_AUTH_TOKEN = "";

const TODAY_AD = "2026-11-22";
const TODAY_BS = "2083-08-06";
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

async function bal(id: string): Promise<number> {
  const { accountTotals } = await import("@/lib/repos/ledger");
  const t = await accountTotals(ALL.from, ALL.to);
  return (t.get(id)?.drPaisa ?? 0) - (t.get(id)?.crPaisa ?? 0);
}

beforeAll(async () => {
  const { __resetDbForTests } = await import("@/lib/db");
  __resetDbForTests();
  const raw = createClient({ url: `file:${DB_FILE}` });
  const migDir = join(__dirname, "..", "db", "migrations");
  for (const f of readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()) {
    for (const stmt of splitStatements(readFileSync(join(migDir, f), "utf8"))) await raw.execute(stmt);
  }
  await raw.execute("INSERT INTO users (id, name, username, password_hash, role_id, created_at) VALUES ('u1','Anita','anita','x','admin','t')");
  await raw.execute("INSERT INTO company (id, name, module_clinic, module_lab, updated_at) VALUES (1, 'Charges Check', 1, 1, 't')");
  await raw.execute("INSERT INTO fiscal_years (bs_label, start_ad, end_ad, active, status) VALUES ('2083/84','2026-07-17','2027-07-16',1,'open')");
  await raw.execute("INSERT INTO suppliers (id, name, active, created_at) VALUES ('sup1','Sample Pharma',1,'t')");
  await raw.execute("INSERT INTO lab_partners (id, name, active, created_at, updated_at) VALUES ('lab1','Sample Path Lab',1,'t','t')");
  await raw.execute(
    `INSERT INTO purchases (id, supplier_id, supplier_invoice_no, purchase_no, date_ad, date_bs, subtotal_paisa, total_paisa, user_id, created_at)
     VALUES ('pur1','sup1','INV-77','PI-2083/84-000001','${TODAY_AD}','${TODAY_BS}',100000,100000,'u1','t')`,
  );
  raw.close();
});

describe("a transfer charge", () => {
  it("on a supplier payment: the supplier is paid Rs 1,000, the bank loses Rs 1,010, Rs 10 is bank charges", async () => {
    const { recordSupplierPayment, supplierBalance, supplierLedger } = await import("@/lib/repos/suppliers");
    await recordSupplierPayment({
      supplierId: "sup1", dateAd: TODAY_AD, dateBs: TODAY_BS, amountPaisa: 100000, method: "qr", note: "",
      userId: "u1", transferChargePaisa: 1000, purchaseId: "pur1",
    });
    expect(await supplierBalance("sup1")).toBe(0);
    expect(await bal("sys:pay_suppliers")).toBe(0);
    expect(await bal("sys:qr")).toBe(-101000);
    expect(await bal("acc:bank_charges")).toBe(1000);
    const { entries } = await supplierLedger("sup1");
    expect(entries.at(-1)!.description).toBe("Payment (qr) · for bill #INV-77 · transfer charge रू 10.00 (not owed to the supplier)");
  });

  it("on a laboratory payment, the same", async () => {
    const { recordPartnerPayment } = await import("@/lib/repos/clinic-reports");
    await recordPartnerPayment({
      partnerId: "lab1", dateAd: TODAY_AD, dateBs: TODAY_BS, amountPaisa: 50000, method: "bank", note: "",
      userId: "u1", transferChargePaisa: 800,
    });
    const { partnerBalancePaisa } = await import("@/lib/repos/lab-partners");
    expect(await partnerBalancePaisa("lab1")).toBe(-50000);
    expect(await bal("sys:pay_labs")).toBe(50000);
    expect(await bal("sys:bank_unassigned")).toBe(-50800);
    expect(await bal("acc:bank_charges")).toBe(1800);
  });
});

describe("delivery for a purchase", () => {
  it("is a payment voucher to Miscellaneous expenses that names the bill, and shows on it", async () => {
    const { createVoucher } = await import("@/lib/repos/accounts");
    await createVoucher({
      type: "payment", dateAd: TODAY_AD, dateBs: TODAY_BS, narration: "Delivery for Sample Pharma bill #INV-77", userId: "u1",
      purchaseId: "pur1",
      lines: [
        { accountId: "acc:misc", partyType: null, partyId: null, debitPaisa: 5000, creditPaisa: 0, note: "Delivery" },
        { accountId: "sys:cash", partyType: null, partyId: null, debitPaisa: 0, creditPaisa: 5000 },
      ],
    });
    expect(await bal("acc:misc")).toBe(5000);
    expect(await bal("sys:cash")).toBe(-5000);
    const { supplierBalance } = await import("@/lib/repos/suppliers");
    expect(await supplierBalance("sup1")).toBe(0);
    const { listPurchases } = await import("@/lib/repos/purchases");
    const [p] = await listPurchases();
    expect(p!.delivery.map((d) => [d.voucherNo, d.amountPaisa])).toEqual([["PV-2083/84-0001", 5000]]);
  });

  it("the whole book balances, document by document", async () => {
    const { db } = await import("@/lib/db");
    const { JOURNAL_SQL } = await import("@/lib/repos/ledger");
    const docs = await db().execute({
      sql: `SELECT src, src_id, SUM(dr) AS dr, SUM(cr) AS cr FROM (${JOURNAL_SQL}) GROUP BY src, src_id`,
      args: ALL,
    });
    expect(docs.rows.length).toBe(4);
    for (const d of docs.rows) expect([d.src, Number(d.dr)]).toEqual([d.src, Number(d.cr)]);
  });

  it("bank charges and miscellaneous expenses can no longer be deleted or switched off", async () => {
    const { getAccount, deleteAccount } = await import("@/lib/repos/accounts");
    for (const id of ["acc:bank_charges", "acc:misc"]) {
      const a = (await getAccount(id))!;
      expect(a.systemKey).not.toBeNull();
      await deleteAccount(id).catch(() => {});
      expect(await getAccount(id)).not.toBeNull();
    }
  });
});
