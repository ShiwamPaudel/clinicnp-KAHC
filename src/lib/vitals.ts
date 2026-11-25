/**
 * vitals.ts — arithmetic on a visit's vitals. Pure; safe in the browser.
 *
 * Nothing here judges a value (Rules §2.6): no "normal", no "overweight", no
 * colour. BMI is weight over height squared, shown as a number, and only for
 * someone 18 or older on the day: a child's BMI means nothing without growth
 * charts, which Rules §2.3 rules out. A change is a plain difference from the
 * last time the same value was recorded.
 */

export interface VitalsValues {
  bp: string;
  pulse: number | null;
  tempC: number | null;
  weightKg: number | null;
  heightCm: number | null;
  spo2: number | null;
}

/** The vitals as typed: every box is text until it is saved. */
export interface VitalsDraft {
  bp: string;
  pulse: string;
  tempC: string;
  weightKg: string;
  heightCm: string;
  spo2: string;
}

export function draftOf(v: VitalsValues): VitalsDraft {
  const s = (x: number | null) => (x == null ? "" : String(x));
  return { bp: v.bp, pulse: s(v.pulse), tempC: s(v.tempC), weightKg: s(v.weightKg), heightCm: s(v.heightCm), spo2: s(v.spo2) };
}

/** What the server gets: blank is null; anything else a number (a slip becomes NaN and is refused there). */
export function payloadOf(d: VitalsDraft): VitalsValues {
  const n = (x: string) => (x.trim() === "" ? null : Number(x.trim()));
  return { bp: d.bp.trim(), pulse: n(d.pulse), tempC: n(d.tempC), weightKg: n(d.weightKg), heightCm: n(d.heightCm), spo2: n(d.spo2) };
}

/** Sane input bounds: what a typing slip looks like, not what is healthy. */
export const VITAL_BOUNDS = {
  pulse: { min: 1, max: 300, label: "Pulse" },
  tempC: { min: 25, max: 45, label: "Temperature" },
  weightKg: { min: 0.3, max: 400, label: "Weight" },
  heightCm: { min: 20, max: 260, label: "Height" },
  spo2: { min: 1, max: 100, label: "SpO₂" },
} as const;

export type NumericVital = keyof typeof VITAL_BOUNDS;

/** The first value outside its bounds, as a message; null when all are fine. */
export function vitalsProblem(v: Partial<VitalsValues>): string | null {
  for (const key of Object.keys(VITAL_BOUNDS) as NumericVital[]) {
    const x = v[key];
    if (x == null) continue;
    const b = VITAL_BOUNDS[key];
    if (!Number.isFinite(x) || x < b.min || x > b.max) return `${b.label} must be a number from ${b.min} to ${b.max}.`;
  }
  if (v.bp != null && v.bp.trim().length > 20) return "BP is too long.";
  return null;
}

export function hasAnyVital(v: Partial<VitalsValues>): boolean {
  return (
    (v.bp ?? "").trim() !== "" ||
    v.pulse != null ||
    v.tempC != null ||
    v.weightKg != null ||
    v.heightCm != null ||
    v.spo2 != null
  );
}

/** BMI to one decimal, or null without both values or for someone under 18. */
export function bmiOf(weightKg: number | null, heightCm: number | null, ageYears: number | null): number | null {
  if (weightKg == null || heightCm == null || ageYears == null || ageYears < 18) return null;
  if (weightKg <= 0 || heightCm <= 0) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

/** "+1.5", "−2", "0": the difference, to at most one decimal. */
export function changeText(now: number | null, before: number | null): string {
  if (now == null || before == null) return "";
  const d = Math.round((now - before) * 10) / 10;
  if (d === 0) return "0";
  return `${d > 0 ? "+" : "−"}${Math.abs(d)}`;
}

/** "120/80" -> [120, 80]; anything else -> null. */
export function parseBp(bp: string): [number, number] | null {
  const m = /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/.exec(bp);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** "+10/−5" between two readings that both read as systolic/diastolic. */
export function bpChangeText(now: string, before: string): string {
  const a = parseBp(now);
  const b = parseBp(before);
  if (!a || !b) return "";
  return `${changeText(a[0], b[0])}/${changeText(a[1], b[1])}`;
}

export interface VitalsRecord extends VitalsValues {
  visitId: string;
  dateBs: string;
  /** when the vitals were taken; null for an old visit that never said */
  at: string | null;
  /** the patient's age in whole years on the visit's date, null when unknown */
  ageYears: number | null;
}

export interface VitalsRow extends VitalsRecord {
  bmi: number | null;
  /** height used for the BMI when none was typed that day (an adult's last height) */
  heightCarried: boolean;
  change: { bp: string; pulse: string; tempC: string; weightKg: string; heightCm: string; bmi: string; spo2: string };
}

/**
 * The card's vitals table: oldest first in, newest first out, each value with
 * its change from the last record that had that value. An adult's height
 * carries forward to work out BMI on a later day with only a weight.
 */
export function vitalsTable(records: VitalsRecord[]): VitalsRow[] {
  const sorted = [...records].sort((x, y) =>
    x.dateBs === y.dateBs ? (x.at ?? "").localeCompare(y.at ?? "") : x.dateBs.localeCompare(y.dateBs),
  );
  const last: Partial<Record<"bp" | NumericVital | "bmi", number | string>> = {};
  let adultHeight: number | null = null;
  const rows: VitalsRow[] = [];
  for (const r of sorted) {
    const adult = r.ageYears != null && r.ageYears >= 18;
    if (r.heightCm != null && adult) adultHeight = r.heightCm;
    const height = r.heightCm ?? (adult ? adultHeight : null);
    const bmi = bmiOf(r.weightKg, height, r.ageYears);
    const num = (k: NumericVital | "bmi", v: number | null) => {
      const t = changeText(v, (last[k] as number | undefined) ?? null);
      if (v != null) last[k] = v;
      return t;
    };
    const bpText = r.bp.trim() ? bpChangeText(r.bp, (last.bp as string | undefined) ?? "") : "";
    if (r.bp.trim()) last.bp = r.bp;
    rows.push({
      ...r,
      bmi,
      heightCarried: r.heightCm == null && bmi != null,
      change: {
        bp: bpText,
        pulse: num("pulse", r.pulse),
        tempC: num("tempC", r.tempC),
        weightKg: num("weightKg", r.weightKg),
        heightCm: num("heightCm", r.heightCm),
        bmi: num("bmi", bmi),
        spo2: num("spo2", r.spo2),
      },
    });
  }
  return rows.reverse();
}
