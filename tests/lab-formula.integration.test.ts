/**
 * Calculated results, default results and follow-up bookings (0035), against a
 * real file database built from the migrations.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { readFileSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ulid } from "ulid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, `lab-formula.${process.pid}-${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;
process.env.TURSO_AUTH_TOKEN = "";

const TODAY_AD = "2026-11-25";
const TODAY_BS = "2083-08-09";

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

const ids: Record<string, string> = {};
let patientId = "";
let blood = "";

const range = { refText: "", refLow: null, refHigh: null, criticalLow: null, criticalHigh: null, overrides: [] };
const base = {
  departmentId: null, method: "", description: "", unit: "", selectOptions: [] as string[], defaultRemarks: "",
  tatHours: null, sortOrder: 0, active: true, billable: true, ratePaisa: 0, vatApplicable: false, parameters: [], ...range,
};

beforeAll(async () => {
  const { __resetDbForTests } = await import("@/lib/db");
  __resetDbForTests();
  const raw = createClient({ url: `file:${DB_FILE}` });
  const migDir = join(__dirname, "..", "db", "migrations");
  for (const f of readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()) {
    for (const stmt of splitStatements(readFileSync(join(migDir, f), "utf8"))) await raw.execute(stmt);
  }
  await raw.execute("INSERT INTO users (id, name, username, password_hash, role_id, created_at) VALUES ('u1','Anita','u1','x','front_desk','t')");
  await raw.execute("INSERT INTO company (id, name, module_clinic, module_lab, updated_at) VALUES (1, 'Formula Check', 1, 1, 't')");
  await raw.execute("INSERT INTO fiscal_years (bs_label, start_ad, end_ad, active, status) VALUES ('2083/84','2026-07-17','2027-07-16',1,'open')");
  raw.close();

  const { createPatient } = await import("@/lib/repos/patients");
  const { saveSampleType } = await import("@/lib/repos/lab-catalog");
  patientId = (
    await createPatient({
      name: "Sita Rai", sex: "f", ageValue: 40, ageUnit: "y", ageAsOfAd: TODAY_AD, dobAd: null,
      phone: "9842000002", address: "Itahari", userId: "u1",
    })
  ).id;
  blood = await saveSampleType({ name: "Blood", colorHex: "#7c3aed", sortOrder: 0, active: true });
});

describe("a calculated test", () => {
  it("saves its formula, decimals and default, and reads them back", async () => {
    const { saveTest, getTest } = await import("@/lib/repos/lab-catalog");
    const t = (name: string, code: string, extra: object = {}) =>
      saveTest({ ...base, name, shortCode: code, sampleTypeId: blood, resultType: "numeric", ...extra });
    ids.hb = (await t("Haemoglobin", "hb")).id;
    ids.rbc = (await t("RBC count", "rbc")).id;
    ids.pcv = (await t("PCV", "pcv", { formula: "{hb} * 3", decimals: 1 })).id;
    ids.mcv = (await t("MCV", "mcv", { formula: "({pcv} * 10) / {rbc}", decimals: 2 })).id;
    const got = (await getTest(ids.pcv!))!;
    expect(got.formula).toBe("{hb} * 3");
    expect(got.decimals).toBe(1);
    ids.ra = (
      await saveTest({ ...base, name: "RA Factor", shortCode: "ra", sampleTypeId: blood, resultType: "pos_neg", defaultValue: "Negative", formula: "{hb}" })
    ).id;
    const ra = (await getTest(ids.ra!))!;
    expect(ra.defaultValue).toBe("Negative");
    // a formula means nothing on a test that is not a number
    expect(ra.formula).toBe("");
  });

  it("refuses an unknown name, the test itself, a ring and a bad formula", async () => {
    const { saveTest, getTest } = await import("@/lib/repos/lab-catalog");
    await expect(
      saveTest({ ...base, name: "X", shortCode: "x", sampleTypeId: blood, resultType: "numeric", formula: "{nope} / 2" }),
    ).rejects.toThrow(/no test has that short code/);
    await expect(
      saveTest({ ...base, name: "Y", shortCode: "y", sampleTypeId: blood, resultType: "numeric", formula: "{y} + 1" }),
    ).rejects.toThrow(/cannot use the test itself/);
    await expect(
      saveTest({ ...base, name: "Z", shortCode: "z", sampleTypeId: blood, resultType: "numeric", formula: "{hb} *" }),
    ).rejects.toThrow(/Formula:/);
    // Haemoglobin worked out from MCV, which reads PCV, which reads Haemoglobin
    const hb = (await getTest(ids.hb!))!;
    await expect(saveTest({ ...hb, id: hb.id, formula: "{mcv} / 2" })).rejects.toThrow(/circle/);
    await expect(saveTest({ ...base, name: "D", shortCode: "d", sampleTypeId: blood, resultType: "numeric", decimals: 9 })).rejects.toThrow(/Decimals/);
  });

  it("a value of a test with several values may read its siblings", async () => {
    const { saveTest, getTest } = await import("@/lib/repos/lab-catalog");
    const p = (name: string, extra: object = {}) => ({
      name, unit: "%", resultType: "numeric" as const, selectOptions: [], defaultRemarks: "", ...range, ...extra,
    });
    ids.dlc = (
      await saveTest({
        ...base, name: "DLC", shortCode: "dlc", sampleTypeId: blood, resultType: "multi",
        parameters: [
          p("Neutrophils"), p("Lymphocytes"), p("Monocytes"),
          p("Eosinophils", { formula: "100 - ({Neutrophils} + {Lymphocytes} + {Monocytes})", decimals: 0 }),
          { ...p("Basophils"), resultType: "select" as const, selectOptions: ["0", "1"], defaultValue: "0" },
        ],
      })
    ).id;
    const dlc = (await getTest(ids.dlc!))!;
    expect(dlc.parameters.map((x) => [x.name, x.formula, x.decimals, x.defaultValue])).toEqual([
      ["Neutrophils", "", null, ""],
      ["Lymphocytes", "", null, ""],
      ["Monocytes", "", null, ""],
      ["Eosinophils", "100 - ({Neutrophils} + {Lymphocytes} + {Monocytes})", 0, ""],
      ["Basophils", "", null, "0"],
    ]);
    await expect(
      saveTest({ ...base, name: "Bad", shortCode: "bad", sampleTypeId: blood, resultType: "multi", parameters: [p("A", { formula: "{A} + 1" })] }),
    ).rejects.toThrow(/from itself/);
  });

  it("on an order, carries the short code, formula and default to Result entry", async () => {
    const { saveProfile, listProfiles } = await import("@/lib/repos/lab-catalog");
    await saveProfile({ name: "CBC", shortCode: "cbc", departmentId: null, active: true, ratePaisa: 50000, vatApplicable: false, testIds: [ids.hb!, ids.rbc!, ids.pcv!, ids.mcv!, ids.dlc!, ids.ra!] });
    const svc = (await listProfiles("profile"))[0]!.serviceId;
    const { ingestBill } = await import("@/lib/repos/bills");
    await ingestBill({
      id: ulid(), dateBs: TODAY_BS, dateAd: TODAY_AD, patientName: "", paymentMethod: "cash", tenderedPaisa: 0,
      paidNowPaisa: undefined, paidNowMethod: "cash", billDiscountPaisa: 0, lines: [],
      serviceLines: [{ id: ulid(), serviceId: svc, qty: 1, ratePaisa: 50000, rateOverridden: false, discountPaisa: 0, doctorId: null, labPartnerId: null, followupApplied: false }],
      patientId, labReportToken: undefined, userId: "u1", clientCreatedAt: new Date().toISOString(),
    });
    const { listOrders, getOrder } = await import("@/lib/repos/lab-orders");
    const [o] = await listOrders("all");
    const order = (await getOrder(o!.id))!;
    const pcv = order.results.find((r) => r.testName === "PCV")!;
    expect(pcv.shortCode).toBe("pcv");
    expect(pcv.fields[0]).toMatchObject({ formula: "{hb} * 3", decimals: 1, defaultValue: "" });
    const ra = order.results.find((r) => r.testName === "RA Factor")!;
    expect(ra.fields[0]).toMatchObject({ formula: "", defaultValue: "Negative", options: ["Positive", "Negative"] });
    const dlc = order.results.find((r) => r.testName === "DLC")!;
    expect(dlc.fields.find((f) => f.label === "Basophils")).toMatchObject({ defaultValue: "0", options: ["0", "1"] });
  });
});

describe("a follow-up booking", () => {
  it("may have no tests; a test booking still needs one", async () => {
    const { createTestBooking, getPrebooking, updateTestBooking, nextFollowupFor } = await import("@/lib/repos/prebookings");
    const input = {
      name: "Sita Rai", phone: "9842000002", patientId, dateAd: "2026-11-30", dateBs: "2083-08-14", timeHhmm: "10:00",
      note: "Review", serviceIds: [] as string[], userId: "u1",
    };
    await expect(createTestBooking(input)).rejects.toThrow(/at least one test/);
    const id = await createTestBooking({ ...input, isFollowup: true });
    const b = (await getPrebooking(id))!;
    expect(b.isFollowup).toBe(true);
    expect(b.items).toEqual([]);
    expect(b.kind).toBe("tests");
    // changed later with still no tests
    await updateTestBooking(id, { ...input, timeHhmm: "11:00" });
    expect((await getPrebooking(id))!.timeHhmm).toBe("11:00");
    expect(await nextFollowupFor(patientId, TODAY_AD)).toEqual({ dateBs: "2083-08-14", timeHhmm: "11:00", doctorName: "" });
    expect(await nextFollowupFor(patientId, "2026-12-01")).toBeNull();
  });

  it("a doctor's appointment booked as a follow-up counts as the next one when it is sooner", async () => {
    const { createDoctor } = await import("@/lib/repos/doctors");
    const { createAppointment } = await import("@/lib/repos/appointments");
    const { nextFollowupFor, FOLLOWUP_REASON } = await import("@/lib/repos/prebookings");
    const doctorId = await createDoctor({
      name: "Dr. Hari Shrestha", qualification: "", specialty: "", nmcNo: "", phone: "", shareBasis: "none" as never,
      shareValue: 0, active: true, email: "", userId: null, notifyPush: false, notifyEmail: false,
    });
    await createAppointment({ doctorId, patientId, dateAd: "2026-11-28", dateBs: "2083-08-12", timeHhmm: "09:30", durationMin: 15, reason: `${FOLLOWUP_REASON}: BP check`, bookedBy: "u1" });
    const next = await nextFollowupFor(patientId, TODAY_AD);
    expect(next).toMatchObject({ dateBs: "2083-08-12", timeHhmm: "09:30" });
    expect(next!.doctorName).not.toBe("");
  });
});
