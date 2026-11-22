/**
 * A test booking is always for a registered patient (owner, 2083-08-06): the
 * front desk searches first and registers someone new from the booking dialog,
 * so "Issue bill" opens the counter with the patient already on it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient } from "@libsql/client";
import { readFileSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = join(__dirname, `prebooking-patient.${process.pid}-${Date.now()}.db`);
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;
process.env.TURSO_AUTH_TOKEN = "";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// the real session module loads next-auth, which only runs inside Next
vi.mock("@/lib/session", () => ({
  NotAuthorizedError: class NotAuthorizedError extends Error {
    userMessage = "You don't have permission to do that.";
  },
  assertPermission: async () => ({ id: "u1", name: "Anita", username: "anita", roleId: "admin", permissions: [] }),
}));

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

let existingId = "";

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
  await raw.execute(`INSERT INTO services (id, name, group_id, rate_paisa, active, created_at, updated_at) VALUES ('svc_tft','TFT','grp_lab',100000,1,'t','t')`);
  await raw.execute(`INSERT INTO services (id, name, group_id, rate_paisa, active, created_at, updated_at) VALUES ('svc_old','Old test','grp_lab',100000,0,'t','t')`);
  raw.close();
  const { createPatient } = await import("@/lib/repos/patients");
  existingId = (
    await createPatient({
      name: "Gita Shrestha", sex: "f", ageValue: 40, ageUnit: "y", ageAsOfAd: "2026-11-22", dobAd: null,
      phone: "9842000002", address: "", userId: "u1",
    })
  ).id;
});

const base = { dateBs: TODAY_BS, timeHhmm: "08:00", note: "", serviceIds: ["svc_tft"] };
const draft = { name: "Maya Gurung", sex: "f" as const, ageValue: 29, ageUnit: "y" as const, phone: "9842000009", address: "Kathmandu" };

async function patientCount(): Promise<number> {
  const { db } = await import("@/lib/db");
  return Number((await db().execute("SELECT COUNT(*) AS n FROM patients")).rows[0]!.n);
}

describe("who a test booking is for", () => {
  it("registers someone new from the booking, and the booking is theirs", async () => {
    const { saveTestBookingAction } = await import("@/app/(app)/prebooking/actions");
    const { getPrebooking } = await import("@/lib/repos/prebookings");
    const before = await patientCount();
    const res = await saveTestBookingAction({ ...base, patientId: "new" }, draft);
    expect(res.ok).toBe(true);
    expect(await patientCount()).toBe(before + 1);
    const b = (await getPrebooking(res.id!))!;
    expect(b.patientId).not.toBeNull();
    expect(b.patientNo).not.toBeNull();
    expect([b.name, b.phone]).toEqual(["Maya Gurung", "9842000009"]);
    expect(b.patient?.name).toBe("Maya Gurung");
    expect(b.patient?.age.value).toBe(29);
  });

  it("books someone already registered under their own name and phone", async () => {
    const { saveTestBookingAction } = await import("@/app/(app)/prebooking/actions");
    const { getPrebooking } = await import("@/lib/repos/prebookings");
    const before = await patientCount();
    const res = await saveTestBookingAction({ ...base, patientId: existingId });
    expect(res.ok).toBe(true);
    expect(await patientCount()).toBe(before);
    const b = (await getPrebooking(res.id!))!;
    expect([b.patientId, b.name, b.phone]).toEqual([existingId, "Gita Shrestha", "9842000002"]);
  });

  it("refuses a booking with nobody chosen", async () => {
    const { saveTestBookingAction } = await import("@/app/(app)/prebooking/actions");
    const res = await saveTestBookingAction({ ...base, patientId: "" });
    expect(res.ok).toBe(false);
    expect(res.userMessage).toBe("Find the patient, or register them");
    const gone = await saveTestBookingAction({ ...base, patientId: "no-such-patient" });
    expect(gone.ok).toBe(false);
  });

  it("registers nobody when the booking itself cannot be saved", async () => {
    const { saveTestBookingAction } = await import("@/app/(app)/prebooking/actions");
    const before = await patientCount();
    const res = await saveTestBookingAction({ ...base, serviceIds: ["svc_old"], patientId: "new" }, { ...draft, name: "Hari Karki" });
    expect(res.ok).toBe(false);
    expect(res.userMessage).toMatch(/no longer billed/);
    expect(await patientCount()).toBe(before);
  });

  it("moves an old booking with no patient onto the one chosen when it is changed", async () => {
    const { saveTestBookingAction } = await import("@/app/(app)/prebooking/actions");
    const { createTestBooking, getPrebooking } = await import("@/lib/repos/prebookings");
    const id = await createTestBooking({
      name: "Gita", phone: "", patientId: null, dateAd: "2026-11-22", dateBs: TODAY_BS, timeHhmm: "09:00", note: "", serviceIds: ["svc_tft"], userId: "u1",
    });
    expect((await getPrebooking(id))!.patient).toBeNull();
    const res = await saveTestBookingAction({ ...base, id, patientId: existingId });
    expect(res.ok).toBe(true);
    const b = (await getPrebooking(id))!;
    expect([b.patientId, b.name]).toEqual([existingId, "Gita Shrestha"]);
  });
});
