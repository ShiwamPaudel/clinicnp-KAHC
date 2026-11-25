/**
 * Test packages (0029): profiles and tests billed as one line at the
 * package's price, opening every test inside it once.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { readFileSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ulid } from "ulid";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, `lab-packages.${process.pid}-${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;
process.env.TURSO_AUTH_TOKEN = "";

const TODAY_AD = "2026-11-22";
const TODAY_BS = "2083-08-06";

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

beforeAll(async () => {
  const { __resetDbForTests } = await import("@/lib/db");
  __resetDbForTests();
  const raw = createClient({ url: `file:${DB_FILE}` });
  const migDir = join(__dirname, "..", "db", "migrations");
  for (const f of readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()) {
    for (const stmt of splitStatements(readFileSync(join(migDir, f), "utf8"))) await raw.execute(stmt);
  }
  await raw.execute("INSERT INTO users (id, name, username, password_hash, role_id, created_at) VALUES ('u1','Anita','u1','x','front_desk','t')");
  await raw.execute("INSERT INTO company (id, name, module_clinic, module_lab, updated_at) VALUES (1, 'Pkg Check', 1, 1, 't')");
  await raw.execute(
    "INSERT INTO fiscal_years (bs_label, start_ad, end_ad, active, status) VALUES ('2083/84','2026-07-17','2027-07-16',1,'open')",
  );
  raw.close();

  const { createPatient } = await import("@/lib/repos/patients");
  const { saveSampleType, saveTest, saveProfile } = await import("@/lib/repos/lab-catalog");
  patientId = (
    await createPatient({
      name: "Ram Thapa", sex: "m", ageValue: 50, ageUnit: "y", ageAsOfAd: TODAY_AD, dobAd: null,
      phone: "9842000001", address: "Itahari", userId: "u1",
    })
  ).id;
  const blood = await saveSampleType({ name: "Blood", colorHex: "#7c3aed", sortOrder: 0, active: true });
  const range = { refText: "", refLow: null, refHigh: null, criticalLow: null, criticalHigh: null, overrides: [] };
  const test = (name: string, rate: number) =>
    saveTest({
      name, shortCode: "", departmentId: null, sampleTypeId: blood, method: "", description: "",
      resultType: "numeric", unit: "", selectOptions: [], defaultRemarks: "", tatHours: null, sortOrder: 0,
      active: true, billable: true, ratePaisa: rate, vatApplicable: false, parameters: [], ...range,
    });
  ids.hb = (await test("Haemoglobin", 10000)).id;
  ids.tlc = (await test("TLC", 10000)).id;
  ids.sugar = (await test("Sugar fasting", 10000)).id;
  ids.tsh = (await test("TSH", 40000)).id;
  ids.cbc = (await saveProfile({ name: "CBC", shortCode: "", departmentId: null, active: true, ratePaisa: 30000, vatApplicable: false, testIds: [ids.hb, ids.tlc] })).id;
  // shares Haemoglobin with CBC on purpose
  ids.diab = (await saveProfile({ name: "Diabetes", shortCode: "", departmentId: null, active: true, ratePaisa: 20000, vatApplicable: false, testIds: [ids.sugar, ids.hb] })).id;
});

describe("a test package", () => {
  it("holds profiles and tests, at its own price, and lists what is in it", async () => {
    const { saveProfile, listProfiles } = await import("@/lib/repos/lab-catalog");
    ids.whole = (
      await saveProfile({
        kind: "package", name: "Whole Body Test", shortCode: "WBT", departmentId: null, active: true,
        ratePaisa: 99900, vatApplicable: false, profileIds: [ids.cbc!, ids.diab!], testIds: [ids.hb!, ids.tsh!],
      })
    ).id;
    const [pkg] = await listProfiles("package");
    expect(pkg!.name).toBe("Whole Body Test");
    expect(pkg!.kind).toBe("package");
    expect(pkg!.ratePaisa).toBe(99900);
    expect(pkg!.profileNames).toEqual(["CBC", "Diabetes"]);
    expect(pkg!.testNames).toEqual(["Haemoglobin", "TSH"]);
    // the profiles screen does not list it; the counter treats it as a lab line
    expect((await listProfiles("profile")).map((p) => p.name).sort()).toEqual(["CBC", "Diabetes"]);
    const { labServiceKinds } = await import("@/lib/repos/lab-catalog");
    expect((await labServiceKinds()).get(pkg!.serviceId)).toBe("group");
    ids.wholeService = pkg!.serviceId;
  });

  it("refuses a package inside a package, and one with a single thing in it", async () => {
    const { saveProfile } = await import("@/lib/repos/lab-catalog");
    await expect(
      saveProfile({
        kind: "package", name: "Bigger", shortCode: "", departmentId: null, active: true, ratePaisa: 0,
        vatApplicable: false, profileIds: [ids.whole!, ids.cbc!], testIds: [],
      }),
    ).rejects.toThrow(/no longer exists/);
    await expect(
      saveProfile({
        kind: "package", name: "Tiny", shortCode: "", departmentId: null, active: true, ratePaisa: 0,
        vatApplicable: false, profileIds: [ids.cbc!], testIds: [],
      }),
    ).rejects.toThrow(/at least two/);
  });

  it("billed, opens each test inside it once, under its profile's name", async () => {
    const { ingestBill } = await import("@/lib/repos/bills");
    await ingestBill({
      id: ulid(), dateBs: TODAY_BS, dateAd: TODAY_AD, patientName: "", paymentMethod: "cash", tenderedPaisa: 0,
      paidNowPaisa: undefined, paidNowMethod: "cash", billDiscountPaisa: 0, lines: [],
      serviceLines: [{
        id: ulid(), serviceId: ids.wholeService!, qty: 1, ratePaisa: 99900, rateOverridden: false, discountPaisa: 0,
        doctorId: null, labPartnerId: null, followupApplied: false,
      }],
      patientId, labReportToken: undefined, userId: "u1", clientCreatedAt: new Date().toISOString(),
    });
    const { listOrders, getOrder } = await import("@/lib/repos/lab-orders");
    const [o] = await listOrders("all");
    const order = (await getOrder(o!.id))!;
    const got = order.results.map((r) => [r.testName, r.groupName]);
    expect(got).toEqual([
      ["Haemoglobin", "CBC"],
      ["TLC", "CBC"],
      ["Sugar fasting", "Diabetes"],
      ["TSH", ""],
    ]);
    // each knows the package it was billed in, so the report puts its notes at the end
    expect(new Set(order.results.map((r) => r.packageName))).toEqual(new Set(["Whole Body Test"]));
    expect(order.samples).toHaveLength(1);
    const { db } = await import("@/lib/db");
    const line = (await db().execute("SELECT name_snapshot, amount_paisa FROM bill_service_lines")).rows[0]!;
    expect([line.name_snapshot, Number(line.amount_paisa)]).toEqual(["Whole Body Test", 99900]);
  });

  it("is listed on the bill as its profiles, then its single tests, each once (owner, 2083-08-08)", async () => {
    // Haemoglobin is in CBC and on its own: done once under CBC, so not listed again
    const { listPosServices } = await import("@/lib/repos/services");
    const svc = (await listPosServices()).find((s) => s.id === ids.wholeService)!;
    expect(svc.includes).toEqual(["CBC", "Diabetes", "TSH"]);
    expect((await listPosServices()).find((s) => s.name === "TSH")!.includes).toBeUndefined();
    // the reprint lists what the lab order opened for the line
    const { listBills, getBillDetail } = await import("@/lib/repos/bills");
    const [b] = await listBills(5);
    const detail = (await getBillDetail(b!.id))!;
    expect(detail.serviceLines[0]!.includes).toEqual(["CBC", "Diabetes", "TSH"]);
    expect(detail.patientSex).toBe("m");
    expect(detail.patientAgeShort).not.toBe("");
    expect(detail.createdAt).not.toBe("");
  });

  it("follows its profiles when they change", async () => {
    const { saveProfile, listProfiles } = await import("@/lib/repos/lab-catalog");
    const cbc = (await listProfiles("profile")).find((p) => p.name === "CBC")!;
    await saveProfile({ id: cbc.id, name: "CBC", shortCode: "", departmentId: null, active: true, ratePaisa: 30000, vatApplicable: false, testIds: [ids.hb!] });
    const [pkg] = await listProfiles("package");
    expect(pkg!.profileIds).toEqual([ids.cbc, ids.diab]);
    await expect(
      saveProfile({ id: pkg!.id, name: "Whole Body Test", shortCode: "", departmentId: null, active: true, ratePaisa: 99900, vatApplicable: false, testIds: [ids.tsh!] }),
    ).rejects.toThrow(/not a profile/);
  });
});
