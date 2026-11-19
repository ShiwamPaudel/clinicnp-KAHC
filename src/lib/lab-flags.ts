/**
 * lab-flags.ts — reading a result against the laboratory's own range.
 *
 * Pure and shared by the result-entry screen (preview) and the server (what is
 * stored). The ranges come from the lab in-charge (Settings → Lab tests); this
 * file never supplies one of its own (Rules §2.2). With no range set, a value
 * is simply not flagged.
 */

export type ResultFlag = "normal" | "low" | "high" | "critical_low" | "critical_high" | "abnormal";

export interface RangeSource {
  refText: string;
  refLow: number | null;
  refHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  /** narrower ranges for one sex and/or an age band */
  overrides: RangeOverride[];
}

export interface RangeOverride {
  sex?: "m" | "f";
  /** inclusive, whole years */
  minAgeYears?: number;
  /** exclusive, whole years */
  maxAgeYears?: number;
  low?: number | null;
  high?: number | null;
  text?: string;
}

export interface PatientFacts {
  sex: "m" | "f" | "o";
  /** whole years today; null when the age was never recorded */
  ageYears: number | null;
}

export interface ResolvedRange {
  refText: string;
  refLow: number | null;
  refHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
}

/** Parse the stored JSON list of overrides; anything malformed is dropped. */
export function parseOverrides(raw: unknown): RangeOverride[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    return list
      .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
      .map((o) => ({
        sex: o.sex === "m" || o.sex === "f" ? o.sex : undefined,
        minAgeYears: num(o.minAgeYears),
        maxAgeYears: num(o.maxAgeYears),
        low: num(o.low) ?? null,
        high: num(o.high) ?? null,
        text: typeof o.text === "string" ? o.text : undefined,
      }));
  } catch {
    return [];
  }
}

/** True when an override applies to this patient. */
function matches(o: RangeOverride, p: PatientFacts): boolean {
  if (o.sex && o.sex !== p.sex) return false;
  if (o.minAgeYears !== undefined || o.maxAgeYears !== undefined) {
    if (p.ageYears == null) return false;
    if (o.minAgeYears !== undefined && p.ageYears < o.minAgeYears) return false;
    if (o.maxAgeYears !== undefined && p.ageYears >= o.maxAgeYears) return false;
  }
  return true;
}

/** How specific an override is — the most specific match wins. */
function specificity(o: RangeOverride): number {
  return (o.sex ? 2 : 0) + (o.minAgeYears !== undefined || o.maxAgeYears !== undefined ? 1 : 0);
}

/**
 * The range that applies to this patient: the most specific matching
 * override (sex and age beats sex beats age), else the general range.
 * Critical limits always come from the general range.
 */
export function resolveRange(src: RangeSource, patient: PatientFacts): ResolvedRange {
  const best = src.overrides
    .filter((o) => matches(o, patient))
    .sort((a, b) => specificity(b) - specificity(a))[0];
  const base = {
    refText: src.refText,
    refLow: src.refLow,
    refHigh: src.refHigh,
    criticalLow: src.criticalLow,
    criticalHigh: src.criticalHigh,
  };
  if (!best) return base;
  return {
    ...base,
    refText: best.text ?? "",
    refLow: best.low ?? null,
    refHigh: best.high ?? null,
  };
}

/** Read a typed value as a number, or null when it is not one. */
export function numericValue(raw: string): number | null {
  const t = raw.trim();
  if (t === "" || !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** The flag a number earns against a range. No range, no flag. */
export function computeFlag(value: number | null, r: ResolvedRange): ResultFlag {
  if (value == null) return "normal";
  if (r.criticalLow != null && value <= r.criticalLow) return "critical_low";
  if (r.criticalHigh != null && value >= r.criticalHigh) return "critical_high";
  if (r.refLow != null && value < r.refLow) return "low";
  if (r.refHigh != null && value > r.refHigh) return "high";
  return "normal";
}

export const isAbnormal = (f: ResultFlag) => f !== "normal";
export const isCritical = (f: ResultFlag) => f === "critical_low" || f === "critical_high";

/** The short mark printed beside a flagged value. */
export function flagSymbol(f: ResultFlag): string {
  switch (f) {
    case "low":
      return "L";
    case "high":
      return "H";
    case "critical_low":
      return "LL";
    case "critical_high":
      return "HH";
    case "abnormal":
      return "*";
    default:
      return "";
  }
}

/** Trim a number for print without inventing precision: 4.50 -> "4.5". */
function fmt(n: number): string {
  return String(Number(n.toFixed(4)));
}

/** The range as printed: the lab's own words if given, else built from the limits. */
export function rangeText(r: { refText: string; refLow: number | null; refHigh: number | null }): string {
  if (r.refText.trim()) return r.refText.trim();
  if (r.refLow != null && r.refHigh != null) return `${fmt(r.refLow)} – ${fmt(r.refHigh)}`;
  if (r.refLow != null) return `> ${fmt(r.refLow)}`;
  if (r.refHigh != null) return `< ${fmt(r.refHigh)}`;
  return "";
}
