/**
 * The Laboratory module (0024, prod-docs/Lab.md), end to end on a file DB:
 * a test is set up, billed at the counter, collected, entered, approved and
 * opened from the bill's QR — and the patient's link waits for the bill to be
 * paid, as the owner asked.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { readFileSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ulid } from "ulid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, `lab.${process.pid}-${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;
process.env.TURSO_AUTH_TOKEN = "";

const TODAY_AD = "2026-11-19";
const TODAY_BS = "2083-08-03";
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
let maleId = "";
let hbTestId = "";
let cbcServiceId = "";
let sugarServiceId = "";
let signatoryId = "";

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
  await raw.execute("INSERT INTO company (id, name, module_clinic, module_lab, updated_at) VALUES (1, 'Lab Check', 1, 1, 't')");
  await raw.execute(
    "INSERT INTO fiscal_years (bs_label, start_ad, end_ad, active, status) VALUES ('2083/84','2026-07-17','2027-07-16',1,'open')",
  );
  await raw.execute(
    "INSERT INTO lab_signatories (id, name, description, sort_order, active, created_at, updated_at) VALUES ('sig1','Dr. Sample Karki','Pathologist',0,1,'t','t')",
  );
  signatoryId = "sig1";
  raw.close();

  const { createPatient } = await import("@/lib/repos/patients");
  const { saveSampleType, saveDepartment, saveTest, saveProfile } = await import("@/lib/repos/lab-catalog");
  const f = await createPatient({
    name: "Anita Shrestha", sex: "f", ageValue: 34, ageUnit: "y", ageAsOfAd: TODAY_AD, dobAd: null,
    phone: "9841000001", address: "Itahari", userId: "u1",
  });
  const m = await createPatient({
    name: "Bikash Karki", sex: "m", ageValue: 40, ageUnit: "y", ageAsOfAd: TODAY_AD, dobAd: null,
    phone: "9841000002", address: "Itahari", userId: "u1",
  });
  patientId = f.id;
  maleId = m.id;

  const blood = await saveSampleType({ name: "Blood (EDTA)", colorHex: "#7c3aed", sortOrder: 0, active: true });
  const serum = await saveSampleType({ name: "Serum", colorHex: "#dc2626", sortOrder: 1, active: true });
  const haem = await saveDepartment({ name: "Haematology", sortOrder: 0, showUnit: true, showRange: true, active: true });

  // Ranges here are invented for the test only — they stand in for whatever
  // the lab in-charge enters, and nothing in the product supplies them.
  const range = { refText: "", refLow: null, refHigh: null, criticalLow: null, criticalHigh: null, overrides: [] };
  const hb = await saveTest({
    name: "Haemoglobin", shortCode: "HB", departmentId: haem, sampleTypeId: blood, method: "", description: "",
    resultType: "numeric", unit: "g/dL", selectOptions: [], defaultRemarks: "", tatHours: null, sortOrder: 0,
    active: true, billable: true, ratePaisa: 20000, vatApplicable: false, parameters: [],
    refText: "", refLow: 10, refHigh: 20, criticalLow: 5, criticalHigh: null,
    overrides: [{ sex: "f", low: 12, high: 15 }, { sex: "m", low: 13, high: 17 }],
  });
  hbTestId = hb.id;
  const tlc = await saveTest({
    name: "Total leucocyte count", shortCode: "TLC", departmentId: haem, sampleTypeId: blood, method: "", description: "",
    resultType: "numeric", unit: "/cumm", selectOptions: [], defaultRemarks: "", tatHours: null, sortOrder: 1,
    active: true, billable: true, ratePaisa: 15000, vatApplicable: false, parameters: [], ...range,
  });
  const sugar = await saveTest({
    name: "Blood sugar (fasting)", shortCode: "FBS", departmentId: null, sampleTypeId: serum, method: "", description: "",
    resultType: "numeric", unit: "mg/dL", selectOptions: [], defaultRemarks: "", tatHours: null, sortOrder: 0,
    active: true, billable: true, ratePaisa: 10000, vatApplicable: false, parameters: [], ...range,
  });
  const profile = await saveProfile({
    name: "Blood count", shortCode: "CBC", departmentId: haem, active: true, ratePaisa: 30000, vatApplicable: false,
    testIds: [hb.id, tlc.id],
  });
  const { db } = await import("@/lib/db");
  const svc = async (table: string, id: string) =>
    (await db().execute({ sql: `SELECT service_id FROM ${table} WHERE id = ?`, args: [id] })).rows[0]!.service_id as string;
  cbcServiceId = await svc("lab_test_groups", profile.id);
  sugarServiceId = await svc("lab_tests", sugar.id);
});

async function bill(opts: { patient: string; services: { id: string; rate: number }[]; method?: "cash" | "credit"; token?: string }) {
  const { ingestBill } = await import("@/lib/repos/bills");
  return ingestBill({
    id: ulid(), dateBs: TODAY_BS, dateAd: TODAY_AD, patientName: "",
    paymentMethod: opts.method ?? "cash", tenderedPaisa: 0, paidNowPaisa: opts.method === "credit" ? 0 : undefined,
    paidNowMethod: "cash", billDiscountPaisa: 0, lines: [],
    serviceLines: opts.services.map((s) => ({
      id: ulid(), serviceId: s.id, qty: 1, ratePaisa: s.rate, rateOverridden: false, discountPaisa: 0,
      doctorId: null, labPartnerId: null, followupApplied: false,
    })),
    patientId: opts.patient, labReportToken: opts.token, userId: "u1", clientCreatedAt: new Date().toISOString(),
  });
}

describe("the catalogue", () => {
  it("bills each test and profile through its own service at the lab price", async () => {
    const { db } = await import("@/lib/db");
    const rows = (await db().execute("SELECT name, rate_paisa FROM services ORDER BY name")).rows;
    expect(rows.map((r) => [r.name, Number(r.rate_paisa)])).toEqual([
      ["Blood count", 30000],
      ["Blood sugar (fasting)", 10000],
      ["Haemoglobin", 20000],
      ["Total leucocyte count", 15000],
    ]);
  });
});

describe("a bill with lab tests", () => {
  let orderId = "";

  it("opens one order, expands the profile, one sample per sample type, and keeps the counter's code", async () => {
    const { listOrders, getOrder } = await import("@/lib/repos/lab-orders");
    const res = await bill({
      patient: patientId,
      services: [{ id: cbcServiceId, rate: 30000 }, { id: sugarServiceId, rate: 10000 }],
      token: "AbCdEfGh23",
    });
    expect(res.labReportToken).toBe("AbCdEfGh23");
    const [o] = await listOrders("all");
    orderId = o!.id;
    const order = (await getOrder(orderId))!;
    expect(order.status).toBe("sample_pending");
    expect(order.results.map((r) => r.testName).sort()).toEqual(["Blood sugar (fasting)", "Haemoglobin", "Total leucocyte count"]);
    expect(order.samples.map((s) => s.sampleTypeName).sort()).toEqual(["Blood (EDTA)", "Serum"]);
    expect(order.samples[0]!.code).toMatch(/^S-\d{6}$/);
  });

  it("is idempotent: the same bill twice still makes one order", async () => {
    const { db } = await import("@/lib/db");
    const before = Number((await db().execute("SELECT COUNT(*) n FROM lab_orders")).rows[0]!.n);
    const { ingestBill } = await import("@/lib/repos/bills");
    const payload = {
      id: ulid(), dateBs: TODAY_BS, dateAd: TODAY_AD, patientName: "", paymentMethod: "cash" as const,
      tenderedPaisa: 0, billDiscountPaisa: 0, lines: [],
      serviceLines: [{ id: ulid(), serviceId: sugarServiceId, qty: 1, ratePaisa: 10000, rateOverridden: false,
        discountPaisa: 0, doctorId: null, labPartnerId: null, followupApplied: false }],
      patientId: maleId, userId: "u1", clientCreatedAt: "t",
    };
    await ingestBill(payload);
    await ingestBill(payload);
    const after = Number((await db().execute("SELECT COUNT(*) n FROM lab_orders")).rows[0]!.n);
    expect(after).toBe(before + 1);
  });

  it("will not take a result before its sample is collected", async () => {
    const { getOrder, saveResults } = await import("@/lib/repos/lab-orders");
    const order = (await getOrder(orderId))!;
    const hb = order.results.find((r) => r.testName === "Haemoglobin")!;
    await expect(
      saveResults(orderId, [{ resultId: hb.id, technicianRemarks: "", values: [{ parameterId: null, value: "11", remarks: "" }] }], "submit", TECH),
    ).rejects.toThrow(/not been collected/);
  });

  it("flags against the range for this patient's sex, and keeps an empty test as a draft", async () => {
    const { getOrder, collectSample, saveResults } = await import("@/lib/repos/lab-orders");
    let order = (await getOrder(orderId))!;
    for (const s of order.samples) await collectSample(s.id, TECH);
    order = (await getOrder(orderId))!;
    const hb = order.results.find((r) => r.testName === "Haemoglobin")!;
    expect(hb.fields[0]!.refText).toBe("12 – 15"); // the female range, not the general one
    const tlc = order.results.find((r) => r.testName === "Total leucocyte count")!;
    const out = await saveResults(
      orderId,
      [
        { resultId: hb.id, technicianRemarks: "", values: [{ parameterId: null, value: "11", remarks: "" }] },
        { resultId: tlc.id, technicianRemarks: "", values: [{ parameterId: null, value: "", remarks: "" }] },
      ],
      "submit",
      TECH,
    );
    expect(out).toEqual({ submitted: 1, drafted: 1 });
    order = (await getOrder(orderId))!;
    const saved = order.results.find((r) => r.testName === "Haemoglobin")!;
    expect(saved.status).toBe("submitted");
    expect(saved.values[0]!.flag).toBe("low");
    expect(saved.hasAbnormal).toBe(true);
  });

  it("keeps the patient's link closed until something is approved", async () => {
    const { resolvePublicReport } = await import("@/lib/repos/lab-orders");
    expect((await resolvePublicReport("AbCdEfGh23")).status).toBe("not_ready");
    expect((await resolvePublicReport("nope")).status).toBe("invalid");
  });

  it("approves with a signature and opens the link for what is done, the rest to follow", async () => {
    const { approveOrder, resolvePublicReport, getOrder } = await import("@/lib/repos/lab-orders");
    await expect(approveOrder(orderId, { signatoryIds: [], interpretations: {} }, PATH)).rejects.toThrow(/signature/);
    const out = await approveOrder(orderId, { signatoryIds: [signatoryId], interpretations: {} }, PATH);
    expect(out.approved).toBe(1);
    const state = await resolvePublicReport("AbCdEfGh23");
    expect(state.status).toBe("ready");
    if (state.status === "ready") expect(state.pendingTests.length).toBe(2);
    expect((await getOrder(orderId))!.signatoryIds).toEqual([signatoryId]);
  });

  it("sends back, re-enters, and is ready only once everything is approved", async () => {
    const { getOrder, saveResults, sendBackResults, approveOrder } = await import("@/lib/repos/lab-orders");
    let order = (await getOrder(orderId))!;
    const entries = order.results
      .filter((r) => r.status !== "approved")
      .map((r) => ({ resultId: r.id, technicianRemarks: "", values: [{ parameterId: null, value: "7000", remarks: "" }] }));
    await saveResults(orderId, entries, "submit", TECH);
    await sendBackResults(orderId, null, "Check the dilution", PATH);
    order = (await getOrder(orderId))!;
    expect(order.results.filter((r) => r.status === "correction_required").length).toBe(2);
    expect(order.status).not.toBe("approved");
    await saveResults(orderId, entries, "submit", TECH);
    await approveOrder(orderId, { signatoryIds: [signatoryId], interpretations: {} }, PATH);
    expect((await getOrder(orderId))!.status).toBe("approved");
  });
});

describe("dues hold the patient's link", () => {
  it("shows 'payment pending' until the bill is paid", async () => {
    const { listOrders, getOrder, collectSample, saveResults, approveOrder, resolvePublicReport } = await import(
      "@/lib/repos/lab-orders"
    );
    await bill({ patient: maleId, services: [{ id: cbcServiceId, rate: 30000 }], method: "credit", token: "ZzYyXxWw98" });
    const o = (await listOrders("all")).find((x) => x.patientId === maleId && x.testNames.includes("Blood count"))!;
    const order = (await getOrder(o.id))!;
    for (const s of order.samples) await collectSample(s.id, TECH);
    const hb = (await getOrder(o.id))!.results.find((r) => r.testName === "Haemoglobin")!;
    expect(hb.fields[0]!.refText).toBe("13 – 17"); // his range, not hers
    await saveResults(o.id, [{ resultId: hb.id, technicianRemarks: "", values: [{ parameterId: null, value: "14", remarks: "" }] }], "submit", TECH);
    await approveOrder(o.id, { signatoryIds: [signatoryId], interpretations: {} }, PATH);
    expect((await resolvePublicReport("ZzYyXxWw98")).status).toBe("payment_pending");
  });

  it("cancelling the bill closes the link", async () => {
    const { resolvePublicReport, listOrders } = await import("@/lib/repos/lab-orders");
    const { cancelBill } = await import("@/lib/repos/bills");
    const { db } = await import("@/lib/db");
    const o = (await listOrders("all")).find((x) => x.patientId === maleId && x.testNames.includes("Blood count"))!;
    const billId = (await db().execute({ sql: "SELECT bill_id FROM lab_orders WHERE id = ?", args: [o.id] })).rows[0]!.bill_id as string;
    await cancelBill(billId, "u1");
    expect((await resolvePublicReport("ZzYyXxWw98")).status).toBe("invalid");
  });
});

describe("a refunded lab test", () => {
  it("leaves the lab's lists, and its tube is no longer asked for", async () => {
    const { listOrders, getOrder, listSamples } = await import("@/lib/repos/lab-orders");
    const { createSaleReturn } = await import("@/lib/repos/sale-returns");
    const { db } = await import("@/lib/db");
    const res = await bill({ patient: patientId, services: [{ id: sugarServiceId, rate: 10000 }], token: "RfNdTst234" });
    const line = (await db().execute({ sql: "SELECT id FROM bill_service_lines WHERE bill_id = ?", args: [res.id] })).rows[0]!.id as string;
    const order = (await listOrders("all")).find((o) => o.id && o.testNames === "Blood sugar (fasting)" && o.status === "sample_pending")!;
    await createSaleReturn({
      billId: res.id, dateAd: TODAY_AD, dateBs: TODAY_BS, lines: [],
      serviceLines: [{ billServiceLineId: line, qty: 1, amountPaisa: 10000 }], userId: "u1",
    });
    expect((await getOrder(order.id))!.status).toBe("cancelled");
    const samples = await listSamples({ status: "waiting" });
    expect(samples.some((s) => s.orderId === order.id)).toBe(false);
  });
});
