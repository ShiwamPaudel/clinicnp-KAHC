/**
 * Pre-booking (0031): a booking with an advance, issued as a bill. The advance
 * comes off what is paid, is handed back when it is more than the bill, and
 * goes back on the booking when the bill is cancelled. The books, the dues and
 * the day close all agree.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { readFileSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ulid } from "ulid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, `prebooking.${process.pid}-${Date.now()}.db`);
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

let patientId = "";

async function bal(id: string): Promise<number> {
  const { accountTotals } = await import("@/lib/repos/ledger");
  const t = await accountTotals(ALL.from, ALL.to);
  return (t.get(id)?.drPaisa ?? 0) - (t.get(id)?.crPaisa ?? 0);
}

async function book(): Promise<string> {
  const { createTestBooking } = await import("@/lib/repos/prebookings");
  return createTestBooking({
    name: "Ram Thapa", phone: "9842000001", patientId, dateAd: TODAY_AD, dateBs: TODAY_BS, timeHhmm: "08:00",
    note: "Fasting", serviceIds: ["svc_tft"], userId: "u1",
  });
}

async function advance(prebookingId: string, rupees: number, method: "cash" | "qr" = "cash") {
  const { receiveAdvance } = await import("@/lib/repos/prebookings");
  return receiveAdvance({ prebookingId, amountPaisa: rupees * 100, method, dateAd: TODAY_AD, dateBs: TODAY_BS, note: "", userId: "u1" });
}

async function bill(prebookingId: string, ratePaisa: number, method: "cash" | "qr" | "credit" = "cash", paidNowPaisa?: number) {
  const { ingestBill } = await import("@/lib/repos/bills");
  return ingestBill({
    id: ulid(), dateBs: TODAY_BS, dateAd: TODAY_AD, patientName: "", paymentMethod: method, tenderedPaisa: 0,
    paidNowPaisa: method === "credit" ? (paidNowPaisa ?? 0) : undefined, paidNowMethod: "cash", billDiscountPaisa: 0, lines: [],
    serviceLines: [{
      id: ulid(), serviceId: "svc_tft", qty: 1, ratePaisa, rateOverridden: ratePaisa !== 100000, discountPaisa: 0,
      doctorId: null, labPartnerId: null, followupApplied: false,
    }],
    patientId, prebookingId, userId: "u1", clientCreatedAt: new Date().toISOString(),
  });
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
  await raw.execute("INSERT INTO company (id, name, module_clinic, module_lab, updated_at) VALUES (1, 'Booking Check', 1, 1, 't')");
  await raw.execute("INSERT INTO fiscal_years (bs_label, start_ad, end_ad, active, status) VALUES ('2083/84','2026-07-17','2027-07-16',1,'open')");
  await raw.execute(
    `INSERT INTO services (id, name, group_id, rate_paisa, active, created_at, updated_at)
     VALUES ('svc_tft','TFT','grp_lab',100000,1,'t','t')`,
  );
  raw.close();
  const { createPatient } = await import("@/lib/repos/patients");
  patientId = (
    await createPatient({
      name: "Ram Thapa", sex: "m", ageValue: 50, ageUnit: "y", ageAsOfAd: TODAY_AD, dobAd: null,
      phone: "9842000001", address: "Itahari", userId: "u1",
    })
  ).id;
});

describe("a booking with an advance", () => {
  let first = "";
  let firstBill = "";

  it("takes an advance with a receipt number, held as owed to the patient", async () => {
    first = await book();
    const r = await advance(first, 300);
    expect(r.receiptLabel).toBe("AR-000001");
    const { getPrebooking } = await import("@/lib/repos/prebookings");
    const p = (await getPrebooking(first))!;
    expect(p.items.map((i) => i.name)).toEqual(["TFT"]);
    expect(p.inHandPaisa).toBe(30000);
    expect(await bal("sys:cash")).toBe(30000);
    expect(await bal("sys:patient_advances")).toBe(-30000);
  });

  it("issued as a bill: the advance comes off, the rest is paid in cash, nothing is owed", async () => {
    const res = await bill(first, 100000, "cash");
    firstBill = res.id;
    expect(res.invoiceNo).toBe(1);
    expect(res.advanceUsedPaisa).toBe(30000);
    expect(res.advanceHandBackPaisa).toBe(0);
    const { db } = await import("@/lib/db");
    const b = (await db().execute({ sql: "SELECT payment_method, due_paisa, paid_now_method FROM bills WHERE id = ?", args: [firstBill] })).rows[0]!;
    expect([b.payment_method, Number(b.due_paisa), b.paid_now_method]).toEqual(["credit", 30000, "cash"]);
    const { getBillDues } = await import("@/lib/repos/dues");
    const dues = (await getBillDues(firstBill))!;
    expect(dues.balancePaisa).toBe(0);
    const { getPrebooking, advanceOnBill } = await import("@/lib/repos/prebookings");
    const p = (await getPrebooking(first))!;
    expect([p.status, p.billId, p.inHandPaisa, p.usedPaisa]).toEqual(["billed", firstBill, 0, 30000]);
    expect(await advanceOnBill(firstBill)).toEqual({ usedPaisa: 30000, labels: "AR-000001", handBackPaisa: 0 });
    expect(await bal("sys:cash")).toBe(100000);
    expect(await bal("sys:patient_advances")).toBe(0);
    expect(await bal("sys:recv_patients")).toBe(0);
  });

  it("is billed once: issuing it again takes nothing from the advance", async () => {
    const res = await bill(first, 100000, "cash");
    expect(res.advanceUsedPaisa).toBe(0);
    const { db } = await import("@/lib/db");
    const b = (await db().execute({ sql: "SELECT payment_method FROM bills WHERE id = ?", args: [res.id] })).rows[0]!;
    expect(b.payment_method).toBe("cash");
    const { cancelBill } = await import("@/lib/repos/bills");
    await cancelBill(res.id, "u1");
  });

  it("more than the bill: the bill is paid from it and the rest is handed back as change", async () => {
    const second = await book();
    await advance(second, 1000, "qr");
    const res = await bill(second, 80000, "cash");
    expect([res.advanceUsedPaisa, res.advanceHandBackPaisa]).toEqual([80000, 20000]);
    const { getPrebooking } = await import("@/lib/repos/prebookings");
    const p = (await getPrebooking(second))!;
    expect(p.inHandPaisa).toBe(0);
    expect(p.moves.map((m) => [m.kind, m.amountPaisa, m.method])).toEqual([
      ["received", 100000, "qr"],
      ["used", 80000, "advance"],
      ["refunded", 20000, "cash"],
    ]);
    expect(await bal("sys:patient_advances")).toBe(0);
    expect(await bal("sys:qr")).toBe(100000);
    // 1,000 cash bill and its cancelled twin, then 200 change handed back
    expect(await bal("sys:cash")).toBe(100000 - 20000);
  });

  it("the bill cancelled: the advance is back on the booking, then refunded when it is closed", async () => {
    const { cancelBill } = await import("@/lib/repos/bills");
    await cancelBill(firstBill, "u1");
    const { getPrebooking, closePrebooking } = await import("@/lib/repos/prebookings");
    let p = (await getPrebooking(first))!;
    expect([p.status, p.billId, p.inHandPaisa]).toEqual(["booked", null, 30000]);
    expect(await bal("sys:patient_advances")).toBe(-30000);
    expect(await bal("sys:recv_patients")).toBe(0);
    const res = await closePrebooking({
      id: first, status: "cancelled", reason: "Not coming", refundMethod: "cash", dateAd: TODAY_AD, dateBs: TODAY_BS, userId: "u1",
    });
    expect(res.refundedPaisa).toBe(30000);
    p = (await getPrebooking(first))!;
    expect([p.status, p.inHandPaisa]).toEqual(["cancelled", 0]);
    expect(await bal("sys:patient_advances")).toBe(0);
  });

  it("an advance paid from the advance cannot be undone in Dues", async () => {
    const third = await book();
    await advance(third, 100);
    const res = await bill(third, 100000, "credit", 0);
    const { db } = await import("@/lib/db");
    const dp = (await db().execute({ sql: "SELECT receipt_id FROM due_payments WHERE bill_id = ? AND method = 'advance'", args: [res.id] })).rows[0]!;
    const { voidDueReceipt } = await import("@/lib/repos/dues");
    await expect(voidDueReceipt(dp.receipt_id as string, "u1")).rejects.toThrow(/advance/);
    const { getBillDues } = await import("@/lib/repos/dues");
    expect((await getBillDues(res.id))!.balancePaisa).toBe(90000);
  });

  it("the books balance, and the day close counts the advances where the money went", async () => {
    const { db } = await import("@/lib/db");
    const { JOURNAL_SQL } = await import("@/lib/repos/ledger");
    const docs = await db().execute({ sql: `SELECT src, src_id, SUM(dr) AS dr, SUM(cr) AS cr FROM (${JOURNAL_SQL}) GROUP BY src, src_id`, args: ALL });
    for (const d of docs.rows) expect([d.src, Number(d.dr)]).toEqual([d.src, Number(d.cr)]);
    const { daySummary } = await import("@/lib/repos/reports");
    const d = await daySummary(TODAY_AD);
    // advances: 300 + 100 cash and 1,000 QR in; 200 change and 300 refund out in cash
    expect(d.advances).toEqual({ inCash: 40000, inQr: 100000, backCash: 50000, backQr: 0 });
    // standing bills: 800 (all from the advance) and 1,000 (100 advance, 900 on dues)
    expect(d.byMethod).toEqual({ cash: 0, qr: 0, credit: 90000, advance: 90000 });
    expect(d.byMethod.cash + d.byMethod.qr + d.byMethod.credit + d.byMethod.advance).toBe(d.grossSalesPaisa);
    expect(d.expectedCashPaisa).toBe(40000 - 50000);
    expect(await bal("sys:cash")).toBe(d.expectedCashPaisa);
  });
});

describe("a doctor's consultation", () => {
  it("gets its booking when an advance is taken, and is not cancelled from elsewhere while it holds one", async () => {
    const { db } = await import("@/lib/db");
    await db().execute(
      "INSERT INTO doctors (id, name, share_basis, share_value, active, created_at, updated_at) VALUES ('doc1','Dr. Sample',  'none', 0, 1, 't', 't')",
    );
    await db().execute({
      sql: `INSERT INTO appointments (id, doctor_id, patient_id, date_ad, date_bs, time_hhmm, duration_min, status, created_at, updated_at)
            VALUES ('ap1','doc1',?,?,?,'10:00',15,'booked','t','t')`,
      args: [patientId, TODAY_AD, TODAY_BS],
    });
    const { bookingForAppointment, getPrebooking, appointmentAdvanceInHand } = await import("@/lib/repos/prebookings");
    const id = await bookingForAppointment("ap1", "u1");
    expect(await bookingForAppointment("ap1", "u1")).toBe(id);
    await advance(id, 500);
    const p = (await getPrebooking(id))!;
    expect([p.kind, p.name, p.timeHhmm, p.doctorName, p.inHandPaisa]).toEqual(["consultation", "Ram Thapa", "10:00", "Dr. Sample", 50000]);
    expect(await appointmentAdvanceInHand("ap1")).toBe(50000);
  });
});
