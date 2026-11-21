/**
 * Tests sent to another laboratory from Result entry (0027, prod-docs/Lab.md),
 * end to end on a file DB: a test reaches Result entry only after its sample
 * is collected; it can be sent out test by test (one bill can mix both); it
 * lands on Reports; its laboratory's price list fills itself in; the charge is
 * owed once a price is set, on that day; an undo is reversed on its own day;
 * and the books, the statement and the laboratory's balance agree throughout.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { readFileSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ulid } from "ulid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, `sendout.${process.pid}-${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;
process.env.TURSO_AUTH_TOKEN = "";

const TECH = { id: "tech", name: "Sita" };
const PATH = { id: "path", name: "Dr. Sample Karki" };

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
let vitDTestId = "";
let vitDServiceId = "";
let sugarServiceId = "";
const PARTNER = "lab1";

/** Today as the app dates things (lab-sendouts.ts uses the same helpers). */
async function todayDates() {
  const { today, toAD, adToIso, bsToDbText } = await import("@/lib/bs");
  const bs = today();
  return { ad: adToIso(toAD(bs)), bs: bsToDbText(bs) };
}

beforeAll(async () => {
  const { __resetDbForTests } = await import("@/lib/db");
  __resetDbForTests();
  const raw = createClient({ url: `file:${DB_FILE}` });
  const migDir = join(__dirname, "..", "db", "migrations");
  for (const f of readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()) {
    for (const stmt of splitStatements(readFileSync(join(migDir, f), "utf8"))) await raw.execute(stmt);
  }
  for (const [id, name, role] of [["u1", "Anita", "front_desk"], ["tech", "Sita", "lab_technician"], ["path", "Dr. Sample Karki", "pathologist"]]) {
    await raw.execute({
      sql: "INSERT INTO users (id, name, username, password_hash, role_id, created_at) VALUES (?, ?, ?, 'x', ?, 't')",
      args: [id!, name!, id!, role!],
    });
  }
  await raw.execute("INSERT INTO company (id, name, module_clinic, module_lab, updated_at) VALUES (1, 'Send-out Check', 1, 1, 't')");
  await raw.execute(
    "INSERT INTO fiscal_years (bs_label, start_ad, end_ad, active, status) VALUES ('2083/84','2026-07-17','2027-07-16',1,'open')",
  );
  await raw.execute(
    "INSERT INTO lab_signatories (id, name, description, sort_order, active, created_at, updated_at) VALUES ('sig1','Dr. Sample Karki','Pathologist',0,1,'t','t')",
  );
  await raw.execute(`INSERT INTO lab_partners (id, name, active, created_at, updated_at) VALUES ('${PARTNER}','City Reference Lab',1,'t','t')`);
  raw.close();

  const { createPatient } = await import("@/lib/repos/patients");
  const { saveSampleType, saveTest } = await import("@/lib/repos/lab-catalog");
  const { today, toAD, adToIso } = await import("@/lib/bs");
  const p = await createPatient({
    name: "Anita Shrestha", sex: "f", ageValue: 34, ageUnit: "y", ageAsOfAd: adToIso(toAD(today())), dobAd: null,
    phone: "9841000001", address: "Itahari", userId: "u1",
  });
  patientId = p.id;
  const serum = await saveSampleType({ name: "Serum", colorHex: "", sortOrder: 0, active: true });
  const range = { refText: "", refLow: null, refHigh: null, criticalLow: null, criticalHigh: null, overrides: [] };
  const base = {
    departmentId: null, sampleTypeId: serum, method: "", description: "", resultType: "numeric" as const,
    selectOptions: [], defaultRemarks: "", tatHours: null, sortOrder: 0, active: true, billable: true,
    vatApplicable: false, parameters: [], ...range,
  };
  const vitD = await saveTest({ ...base, name: "Vitamin D", shortCode: "VITD", unit: "ng/mL", ratePaisa: 250000 });
  const sugar = await saveTest({ ...base, name: "Blood sugar (fasting)", shortCode: "FBS", unit: "mg/dL", ratePaisa: 10000 });
  vitDTestId = vitD.id;
  const { db } = await import("@/lib/db");
  const svc = async (id: string) =>
    (await db().execute({ sql: "SELECT service_id FROM lab_tests WHERE id = ?", args: [id] })).rows[0]!.service_id as string;
  vitDServiceId = await svc(vitD.id);
  sugarServiceId = await svc(sugar.id);
});

async function billBoth(): Promise<string> {
  const { ingestBill } = await import("@/lib/repos/bills");
  const d = await todayDates();
  const billId = ulid();
  await ingestBill({
    id: billId, dateBs: d.bs, dateAd: d.ad, patientName: "",
    paymentMethod: "cash", tenderedPaisa: 0, paidNowMethod: "cash", billDiscountPaisa: 0, lines: [],
    serviceLines: [
      { id: ulid(), serviceId: vitDServiceId, qty: 1, ratePaisa: 250000, rateOverridden: false, discountPaisa: 0, doctorId: null, labPartnerId: null, followupApplied: false },
      { id: ulid(), serviceId: sugarServiceId, qty: 1, ratePaisa: 10000, rateOverridden: false, discountPaisa: 0, doctorId: null, labPartnerId: null, followupApplied: false },
    ],
    patientId, userId: "u1", clientCreatedAt: new Date().toISOString(),
  });
  const { orderIdForBill } = await import("@/lib/repos/lab-orders");
  return (await orderIdForBill(billId))!;
}

async function labOwed(): Promise<{ page: number; books: number; checksOk: boolean }> {
  const { partnerBalancePaisa } = await import("@/lib/repos/lab-partners");
  const { partyBalanceAt } = await import("@/lib/repos/ledger");
  const { bookChecks } = await import("@/lib/repos/ledger-reports");
  const checks = await bookChecks();
  return {
    page: await partnerBalancePaisa(PARTNER),
    books: 0 - (await partyBalanceAt("lab_partner", PARTNER, "9999-12-31")),
    checksOk: checks.filter((c) => c.key === "balanced" || c.key === "labs").every((c) => c.ok),
  };
}

describe("a bill with one test done here and one sent out", () => {
  let orderId = "";
  let vitDResult = "";
  let sugarResult = "";

  it("reaches Result entry only once its sample is collected", async () => {
    const { listOrders, getOrder, collectSample } = await import("@/lib/repos/lab-orders");
    orderId = await billBoth();
    expect((await listOrders("results")).some((o) => o.id === orderId)).toBe(false);
    const order = (await getOrder(orderId))!;
    vitDResult = order.results.find((r) => r.testName === "Vitamin D")!.id;
    sugarResult = order.results.find((r) => r.testName === "Blood sugar (fasting)")!.id;

    const { sendOutResults } = await import("@/lib/repos/lab-sendouts");
    await expect(
      sendOutResults({ orderId, resultIds: [vitDResult], partnerId: PARTNER, user: TECH }),
    ).rejects.toThrow(/not been collected/);

    await collectSample(order.samples[0]!.id, TECH);
    expect((await listOrders("results")).some((o) => o.id === orderId)).toBe(true);
  });

  it("sends one test out; it goes to Reports and onto the laboratory's price list with no price", async () => {
    const { sendOutResults, listPartnerPrices } = await import("@/lib/repos/lab-sendouts");
    const { getOrder, listOrders } = await import("@/lib/repos/lab-orders");
    const out = await sendOutResults({ orderId, resultIds: [vitDResult], partnerId: PARTNER, user: TECH });
    expect(out).toEqual({ sent: 1, unpriced: 1 });

    const order = (await getOrder(orderId))!;
    expect(order.results.find((r) => r.id === vitDResult)!.status).toBe("sent_out");
    expect(order.results.find((r) => r.id === sugarResult)!.status).toBe("pending");
    // still in Result entry for the sugar, and already on Reports for the Vitamin D
    expect((await listOrders("results")).some((o) => o.id === orderId)).toBe(true);
    const onReports = (await listOrders("reports")).find((o) => o.id === orderId);
    expect(onReports?.counts.sentOut).toBe(1);

    const prices = await listPartnerPrices(PARTNER);
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({ testId: vitDTestId, costPaisa: null, timesSent: 1, unpriced: 1 });

    // nothing is owed until the laboratory's price is known
    expect(await labOwed()).toEqual({ page: 0, books: 0, checksOk: true });
  });

  it("refuses to send a test twice", async () => {
    const { sendOutResults } = await import("@/lib/repos/lab-sendouts");
    await expect(
      sendOutResults({ orderId, resultIds: [vitDResult], partnerId: PARTNER, user: TECH }),
    ).rejects.toThrow(/no longer waiting/);
  });

  it("charges the laboratory once its price is set, and the books, statement and page agree", async () => {
    const { setPartnerPrice, listPartnerPrices } = await import("@/lib/repos/lab-sendouts");
    expect(await setPartnerPrice(PARTNER, vitDTestId, 150000)).toEqual({ filled: 1 });
    expect((await listPartnerPrices(PARTNER))[0]).toMatchObject({ costPaisa: 150000, unpriced: 0 });
    expect(await labOwed()).toEqual({ page: 150000, books: 150000, checksOk: true });

    const { partnerStatement } = await import("@/lib/repos/clinic-reports");
    const d = await todayDates();
    const st = (await partnerStatement(PARTNER, { fromIso: d.ad, toIso: d.ad }))!;
    expect(st.testsPaisa).toBe(150000);
    expect(st.billedPaisa).toBe(250000);
    expect(st.closingPaisa).toBe(150000);

    const { profitAndLoss } = await import("@/lib/repos/ledger-reports");
    const pl = await profitAndLoss(d.ad, d.ad);
    expect(JSON.stringify(pl)).toContain("Outside laboratory charges");
  });

  it("is ready once the test done here is approved", async () => {
    const { saveResults, approveOrder, getOrder, resolvePublicReport } = await import("@/lib/repos/lab-orders");
    await saveResults(
      orderId,
      [{ resultId: sugarResult, technicianRemarks: "", values: [{ parameterId: null, value: "92", remarks: "" }] }],
      "submit",
      TECH,
    );
    await approveOrder(orderId, { signatoryIds: ["sig1"], interpretations: {} }, PATH);
    const order = (await getOrder(orderId))!;
    expect(order.status).toBe("approved");
    // the patient's link shows what was done here and does not list the sent test as still running
    const state = await resolvePublicReport(order.reportToken);
    expect(state.status).toBe("ready");
    if (state.status === "ready") expect(state.pendingTests).toEqual([]);
  });

  it("brings a test back, and reverses the charge on the day of the undo", async () => {
    const { listOrderSendouts, undoSendOut, listPartnerPrices } = await import("@/lib/repos/lab-sendouts");
    const { getOrder, listOrders } = await import("@/lib/repos/lab-orders");
    const [so] = await listOrderSendouts(orderId);
    await expect(undoSendOut(so!.id, "", TECH)).rejects.toThrow(/why/);
    await undoSendOut(so!.id, "Done here instead", TECH);

    const order = (await getOrder(orderId))!;
    expect(order.results.find((r) => r.id === vitDResult)!.status).toBe("pending");
    expect(order.status).toBe("result_pending");
    expect((await listOrders("results")).some((o) => o.id === orderId)).toBe(true);
    expect(await listOrderSendouts(orderId)).toEqual([]);
    // the price stays on the list for next time
    expect((await listPartnerPrices(PARTNER))[0]).toMatchObject({ costPaisa: 150000, timesSent: 0 });
    expect(await labOwed()).toEqual({ page: 0, books: 0, checksOk: true });

    // the statement shows both the charge and its reversal
    const { partnerStatement } = await import("@/lib/repos/clinic-reports");
    const d = await todayDates();
    const st = (await partnerStatement(PARTNER, { fromIso: d.ad, toIso: d.ad }))!;
    expect(st.entries.map((e) => e.chargePaisa)).toEqual([150000, -150000]);
    expect(st.closingPaisa).toBe(0);
  });

  it("charges at the known price straight away when sent again", async () => {
    const { sendOutResults } = await import("@/lib/repos/lab-sendouts");
    expect(await sendOutResults({ orderId, resultIds: [vitDResult], partnerId: PARTNER, user: TECH })).toEqual({ sent: 1, unpriced: 0 });
    expect(await labOwed()).toEqual({ page: 150000, books: 150000, checksOk: true });
  });

  it("keeps the laboratory's charge when the bill is cancelled after the sample went out", async () => {
    const { cancelBill } = await import("@/lib/repos/bills");
    const { getOrder } = await import("@/lib/repos/lab-orders");
    const { db } = await import("@/lib/db");
    const billId = (await db().execute({ sql: "SELECT bill_id FROM lab_orders WHERE id = ?", args: [orderId] })).rows[0]!.bill_id as string;
    await cancelBill(billId, "u1");
    const order = (await getOrder(orderId))!;
    expect(order.status).toBe("cancelled");
    expect(order.results.find((r) => r.id === vitDResult)!.status).toBe("sent_out");
    expect(await labOwed()).toEqual({ page: 150000, books: 150000, checksOk: true });
  });
});
