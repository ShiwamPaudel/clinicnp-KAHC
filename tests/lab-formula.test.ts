import { describe, it, expect } from "vitest";
import {
  evaluateFormula,
  formulaProblem,
  formulaRefs,
  formatCalculated,
  recalculate,
  isOtherOption,
  type CalcField,
} from "@/lib/lab-formula";

const lookup = (m: Record<string, number | null>) => (name: string) => m[name.toLowerCase()] ?? null;

describe("a lab formula", () => {
  it("works out + - * / with brackets and names", () => {
    expect(evaluateFormula("{chol} / {hdl}", lookup({ chol: 181.1, hdl: 45.9 }))).toBeCloseTo(3.9455, 3);
    expect(evaluateFormula("({hb} * 10) / {rbc}", lookup({ hb: 11.7, rbc: 5.61 }))).toBeCloseTo(20.856, 3);
    expect(evaluateFormula("100 - ({n} + {l} + {m})", lookup({ n: 64, l: 28, m: 6 }))).toBe(2);
    expect(evaluateFormula("{tg} / 5", lookup({ tg: 118.2 }))).toBeCloseTo(23.64, 5);
    expect(evaluateFormula("-{a} + 2", lookup({ a: 1 }))).toBe(1);
    expect(evaluateFormula("{hb} x 3", lookup({ hb: 11.7 }))).toBeCloseTo(35.1, 5);
  });

  it("gives nothing when an input is missing, or on dividing by zero", () => {
    expect(evaluateFormula("{chol} / {hdl}", lookup({ chol: 181.1 }))).toBeNull();
    expect(evaluateFormula("{a} / {b}", lookup({ a: 1, b: 0 }))).toBeNull();
  });

  it("says what is wrong with a badly written formula, and never runs code", () => {
    expect(formulaProblem("{chol} / {hdl}")).toBeNull();
    expect(formulaProblem("")).toBeNull();
    expect(formulaProblem("{chol} /")).toMatch(/ends too early/);
    expect(formulaProblem("({a} + 1")).toMatch(/not closed/);
    expect(formulaProblem("alert(1)")).toMatch(/not allowed/);
    expect(formulaProblem("{a")).toMatch(/not closed/);
    expect(formulaProblem("1.2.3")).toMatch(/not a number/);
  });

  it("lists the names it reads, once each", () => {
    expect(formulaRefs("({hb} * 100) / {pcv} + {HB}")).toEqual(["hb", "pcv"]);
  });

  it("rounds to the test's decimals, 2 when not set", () => {
    expect(formatCalculated(3.9455, 1)).toBe("3.9");
    expect(formatCalculated(62.5668, null)).toBe("62.57");
    expect(formatCalculated(2, 0)).toBe("2");
    expect(formatCalculated(-0.0001, 2)).toBe("0.00");
  });

  it("knows the choice that opens a text box", () => {
    expect(isOtherOption("Other")).toBe(true);
    expect(isOtherOption("Others")).toBe(true);
    expect(isOtherOption("Nil")).toBe(false);
  });
});

// the CBC on the owner's photo, filled the way Result entry fills it
const cbc: CalcField[] = [
  { id: "hb", group: "r1", code: "hb", paramName: null, formula: "", decimals: null },
  { id: "rbc", group: "r2", code: "rbc", paramName: null, formula: "", decimals: null },
  { id: "pcv", group: "r3", code: "pcv", paramName: null, formula: "{hb} * 3", decimals: 1 },
  { id: "mcv", group: "r4", code: "mcv", paramName: null, formula: "({pcv} * 10) / {rbc}", decimals: 2 },
  { id: "mch", group: "r5", code: "mch", paramName: null, formula: "({hb} * 10) / {rbc}", decimals: 2 },
  { id: "mchc", group: "r6", code: "mchc", paramName: null, formula: "({hb} * 100) / {pcv}", decimals: 2 },
  { id: "neu", group: "dlc", code: "dlc", paramName: "Neutrophils", formula: "", decimals: null },
  { id: "lym", group: "dlc", code: "dlc", paramName: "Lymphocytes", formula: "", decimals: null },
  { id: "mono", group: "dlc", code: "dlc", paramName: "Monocytes", formula: "", decimals: null },
  { id: "eos", group: "dlc", code: "dlc", paramName: "Eosinophils", formula: "100 - ({Neutrophils} + {Lymphocytes} + {Monocytes})", decimals: 0 },
  { id: "baso", group: "dlc", code: "dlc", paramName: "Basophils", formula: "", decimals: null },
];

describe("filling the calculated boxes of an order", () => {
  it("fills a chain (MCV reads PCV, which reads Hb), as on the photo", () => {
    const v = new Map([["hb", "11.7"], ["rbc", "5.61"], ["neu", "64"], ["lym", "28"], ["mono", "6"], ["baso", "0"]]);
    const got = recalculate(cbc, v, new Set());
    expect(Object.fromEntries(got)).toEqual({ pcv: "35.1", mcv: "62.57", mch: "20.86", mchc: "33.33", eos: "2" });
  });

  it("leaves a box typed over by hand alone, and works on from it", () => {
    const v = new Map([["hb", "11.7"], ["rbc", "5.61"], ["pcv", "36.0"]]);
    const got = recalculate(cbc, v, new Set(["pcv"]));
    expect(got.has("pcv")).toBe(false);
    expect(got.get("mcv")).toBe("64.17");
    expect(got.get("mchc")).toBe("32.50");
  });

  it("empties a calculated box when an input is taken away", () => {
    const v = new Map([["hb", ""], ["rbc", "5.61"], ["pcv", "35.1"], ["mch", "20.86"]]);
    const got = recalculate(cbc, v, new Set());
    expect(got.get("pcv")).toBe("");
    expect(got.get("mch")).toBe("");
  });

  it("waits for all three before Eosinophils", () => {
    const got = recalculate(cbc, new Map([["neu", "64"], ["lym", "28"]]), new Set());
    expect(got.has("eos")).toBe(false);
  });

  it("finds another test's value as code.Value", () => {
    const f: CalcField[] = [
      ...cbc,
      { id: "x", group: "r9", code: "x", paramName: null, formula: "{dlc.Neutrophils} / 2", decimals: 0 },
    ];
    expect(recalculate(f, new Map([["neu", "64"]]), new Set()).get("x")).toBe("32");
  });

  it("stops on a ring instead of looping", () => {
    const ring: CalcField[] = [
      { id: "a", group: "a", code: "a", paramName: null, formula: "{b} + 1", decimals: 0 },
      { id: "b", group: "b", code: "b", paramName: null, formula: "{a} + 1", decimals: 0 },
    ];
    expect(() => recalculate(ring, new Map([["a", "1"]]), new Set())).not.toThrow();
  });
});
