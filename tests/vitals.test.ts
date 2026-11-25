/**
 * Vitals arithmetic (owner, 2083-08-09): BMI from height and weight for an
 * adult, a plain difference from the last record, an adult's height carried
 * forward. Nothing is judged (Rules §2.6).
 */
import { describe, it, expect } from "vitest";
import { bmiOf, bpChangeText, changeText, payloadOf, vitalsProblem, vitalsTable, type VitalsRecord } from "@/lib/vitals";

describe("BMI", () => {
  it("is weight over height squared, to one decimal, for someone 18 or older", () => {
    expect(bmiOf(70, 175, 40)).toBe(22.9);
    expect(bmiOf(70, 175, 18)).toBe(22.9);
  });
  it("is not worked out for a child, or without both values", () => {
    expect(bmiOf(30, 130, 10)).toBeNull();
    expect(bmiOf(70, null, 40)).toBeNull();
    expect(bmiOf(null, 175, 40)).toBeNull();
    expect(bmiOf(70, 175, null)).toBeNull();
  });
});

describe("a change from last time", () => {
  it("is a signed difference, never a judgement", () => {
    expect(changeText(68.5, 70)).toBe("−1.5");
    expect(changeText(72, 70)).toBe("+2");
    expect(changeText(70, 70)).toBe("0");
    expect(changeText(70, null)).toBe("");
    expect(bpChangeText("130/85", "120/80")).toBe("+10/+5");
    expect(bpChangeText("high", "120/80")).toBe("");
  });
});

describe("typing slips", () => {
  it("are refused; real values are not judged", () => {
    expect(vitalsProblem({ pulse: 7000 })).toMatch(/Pulse/);
    expect(vitalsProblem(payloadOf({ bp: "", pulse: "abc", tempC: "", weightKg: "", heightCm: "", spo2: "" }))).toMatch(/Pulse/);
    expect(vitalsProblem({ heightCm: 5 })).toMatch(/Height/);
    expect(vitalsProblem({ pulse: 180, tempC: 41, weightKg: 150, heightCm: 200, spo2: 70, bp: "200/120" })).toBeNull();
  });
});

const rec = (o: Partial<VitalsRecord> & { dateBs: string }): VitalsRecord => ({
  visitId: o.dateBs, at: null, ageYears: 40, bp: "", pulse: null, tempC: null, weightKg: null, heightCm: null, spo2: null, ...o,
});

describe("the card's vitals table", () => {
  it("lists newest first, each value against the last time it was recorded", () => {
    const rows = vitalsTable([
      rec({ dateBs: "2083-08-01", weightKg: 80, heightCm: 170, bp: "130/85" }),
      rec({ dateBs: "2083-08-09", weightKg: 78, bp: "125/80" }),
      rec({ dateBs: "2083-08-05", pulse: 72 }),
    ]);
    expect(rows.map((r) => r.dateBs)).toEqual(["2083-08-09", "2083-08-05", "2083-08-01"]);
    const latest = rows[0]!;
    expect(latest.change.weightKg).toBe("−2");
    expect(latest.change.bp).toBe("−5/−5");
    // the adult's height from the first visit gives a BMI on the latest
    expect(latest.bmi).toBe(27);
    expect(latest.heightCarried).toBe(true);
    expect(latest.change.bmi).toBe("−0.7");
    expect(rows[2]!.bmi).toBe(27.7);
    expect(rows[2]!.change.weightKg).toBe("");
  });

  it("gives a child no BMI and does not carry a child's height", () => {
    const rows = vitalsTable([
      rec({ dateBs: "2083-01-01", ageYears: 12, weightKg: 35, heightCm: 140 }),
      rec({ dateBs: "2083-08-01", ageYears: 12, weightKg: 36 }),
    ]);
    expect(rows.every((r) => r.bmi === null)).toBe(true);
  });
});
