/**
 * Vitals on a visit (0033): height is kept, the time they were taken is
 * stamped when a value changes and cleared with the last one, and the card
 * lists them by date with the patient's age on each day.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { readFileSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, `vitals.${process.pid}-${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;
process.env.TURSO_AUTH_TOKEN = "";

function splitStatements(sql: string): string[] {
  return sql
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

let patientId = "";

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${DB_FILE}${suffix}`, { force: true });
    } catch {
      // a lingering handle on Windows
    }
  }
});

beforeAll(async () => {
  const { __resetDbForTests } = await import("@/lib/db");
  __resetDbForTests();
  const raw = createClient({ url: `file:${DB_FILE}` });
  const migDir = join(__dirname, "..", "db", "migrations");
  for (const f of readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()) {
    for (const stmt of splitStatements(readFileSync(join(migDir, f), "utf8"))) await raw.execute(stmt);
  }
  await raw.execute("INSERT INTO users (id, name, username, password_hash, role_id, created_at) VALUES ('u1','Sita','u1','x','front_desk','t')");
  await raw.execute("INSERT INTO company (id, name, module_clinic, updated_at) VALUES (1, 'Vitals Check', 1, 't')");
  await raw.execute("INSERT INTO fiscal_years (bs_label, start_ad, end_ad, active, status) VALUES ('2083/84','2026-07-17','2027-07-16',1,'open')");
  raw.close();
  const { createPatient } = await import("@/lib/repos/patients");
  patientId = (
    await createPatient({
      name: "Ram Thapa", sex: "m", ageValue: 40, ageUnit: "y", ageAsOfAd: "2026-11-01", dobAd: null,
      phone: "9842000001", address: "Itahari", userId: "u1",
    })
  ).id;
});

describe("vitals on a visit", () => {
  it("keeps height, stamps when they were taken, and lists them on the card by date", async () => {
    const { createVisit, updateVisit, getVisit, vitalsForPatient } = await import("@/lib/repos/visits");
    const first = await createVisit({
      patientId, dateAd: "2026-11-17", dateBs: "2083-08-01", type: "new", userId: "u1",
      vitals: { bp: "130/85", weightKg: 80, heightCm: 170 },
    });
    expect(first.heightCm).toBe(170);
    expect(first.vitalsAt).not.toBeNull();

    const second = await createVisit({ patientId, dateAd: "2026-11-25", dateBs: "2083-08-09", type: "followup", userId: "u1" });
    expect(second.vitalsAt).toBeNull();
    // saving the visit's notes alone does not stamp vitals
    await updateVisit({ id: second.id, complaint: "Review", vitals: { bp: "", pulse: null, tempC: null, weightKg: null, heightCm: null, spo2: null } });
    expect((await getVisit(second.id))!.vitalsAt).toBeNull();
    await updateVisit({ id: second.id, vitals: { bp: "125/80", pulse: null, tempC: null, weightKg: 78, heightCm: null, spo2: null } });
    const stamped = (await getVisit(second.id))!.vitalsAt;
    expect(stamped).not.toBeNull();
    // the same values again keep the stamp
    await updateVisit({ id: second.id, vitals: { bp: "125/80", weightKg: 78 } });
    expect((await getVisit(second.id))!.vitalsAt).toBe(stamped);

    const records = await vitalsForPatient(patientId);
    expect(records.map((r) => [r.dateBs, r.weightKg, r.heightCm, r.ageYears])).toEqual([
      ["2083-08-01", 80, 170, 40],
      ["2083-08-09", 78, null, 40],
    ]);

    // emptied: off the card, the stamp cleared
    await updateVisit({ id: second.id, vitals: { bp: "", weightKg: null } });
    expect((await getVisit(second.id))!.vitalsAt).toBeNull();
    expect(await vitalsForPatient(patientId)).toHaveLength(1);
  });
});
