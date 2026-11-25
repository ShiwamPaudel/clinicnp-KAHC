/**
 * lab-formula.ts — calculated lab results (0035, owner 2083-08-09).
 *
 * A numeric test or value can carry a formula such as `{chol} / {hdl}` or
 * `({hb} * 10) / {rbc}`. A name in braces is another test's short code, or,
 * inside a test with several values, one of its own values by name
 * (`{Neutrophils}`). Only numbers, + - * /, brackets and those names are
 * allowed; the text is read by the small parser below, never run as code.
 *
 * Result entry fills a calculated box as its inputs are typed, and the box stays
 * editable. Pure: shared by the test editor, Result entry and the server checks.
 */

export type FormulaToken =
  | { kind: "num"; value: number }
  | { kind: "ref"; name: string }
  | { kind: "op"; op: "+" | "-" | "*" | "/" }
  | { kind: "paren"; open: boolean };

export class FormulaError extends Error {}

/** Split a formula into tokens; throws FormulaError on anything not allowed. */
export function tokenize(src: string): FormulaToken[] {
  const out: FormulaToken[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const text = src.slice(i, j);
      if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) throw new FormulaError(`"${text}" is not a number.`);
      out.push({ kind: "num", value: Number(text) });
      i = j;
    } else if (c === "{") {
      const end = src.indexOf("}", i);
      if (end < 0) throw new FormulaError("A name in braces is not closed with }.");
      const name = src.slice(i + 1, end).trim();
      if (!name) throw new FormulaError("Empty braces {} in the formula.");
      out.push({ kind: "ref", name });
      i = end + 1;
    } else if (c === "+" || c === "-" || c === "*" || c === "/") {
      out.push({ kind: "op", op: c });
      i++;
    } else if (c === "×" || c === "x" || c === "X") {
      // what people write on paper
      out.push({ kind: "op", op: "*" });
      i++;
    } else if (c === "÷") {
      out.push({ kind: "op", op: "/" });
      i++;
    } else if (c === "(" || c === ")") {
      out.push({ kind: "paren", open: c === "(" });
      i++;
    } else {
      throw new FormulaError(`"${c}" is not allowed in a formula. Use numbers, + - * / ( ) and {short code}.`);
    }
  }
  return out;
}

type Node =
  | { t: "num"; v: number }
  | { t: "ref"; name: string }
  | { t: "neg"; a: Node }
  | { t: "bin"; op: "+" | "-" | "*" | "/"; a: Node; b: Node };

/** Parse to a tree; throws FormulaError when the formula is not well formed. */
export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  if (toks.length === 0) throw new FormulaError("The formula is empty.");
  let pos = 0;
  const peek = () => toks[pos];
  function expr(): Node {
    let a = term();
    for (let t = peek(); t && t.kind === "op" && (t.op === "+" || t.op === "-"); t = peek()) {
      pos++;
      a = { t: "bin", op: t.op, a, b: term() };
    }
    return a;
  }
  function term(): Node {
    let a = unary();
    for (let t = peek(); t && t.kind === "op" && (t.op === "*" || t.op === "/"); t = peek()) {
      pos++;
      a = { t: "bin", op: t.op, a, b: unary() };
    }
    return a;
  }
  function unary(): Node {
    const t = peek();
    if (t && t.kind === "op" && t.op === "-") {
      pos++;
      return { t: "neg", a: unary() };
    }
    return atom();
  }
  function atom(): Node {
    const t = peek();
    if (!t) throw new FormulaError("The formula ends too early.");
    pos++;
    if (t.kind === "num") return { t: "num", v: t.value };
    if (t.kind === "ref") return { t: "ref", name: t.name };
    if (t.kind === "paren" && t.open) {
      const inner = expr();
      const close = peek();
      if (!close || close.kind !== "paren" || close.open) throw new FormulaError("A bracket ( is not closed.");
      pos++;
      return inner;
    }
    throw new FormulaError("The formula is not written correctly.");
  }
  const tree = expr();
  if (pos !== toks.length) throw new FormulaError("The formula is not written correctly.");
  return tree;
}

/** The names a formula reads, in the order written, each once. */
export function formulaRefs(src: string): string[] {
  const seen: string[] = [];
  for (const t of tokenize(src)) {
    if (t.kind === "ref" && !seen.some((s) => s.toLowerCase() === t.name.toLowerCase())) seen.push(t.name);
  }
  return seen;
}

/** A problem with the formula in words, or null when it is fine. */
export function formulaProblem(src: string): string | null {
  if (!src.trim()) return null;
  try {
    parseFormula(src);
    return null;
  } catch (e) {
    return e instanceof FormulaError ? e.message : "The formula is not written correctly.";
  }
}

/**
 * Work the formula out. `lookup` gives each name's number, or null when that
 * box is empty or not a number; any missing input, a division by zero or a
 * malformed formula gives null.
 */
export function evaluateFormula(src: string, lookup: (name: string) => number | null): number | null {
  let tree: Node;
  try {
    tree = parseFormula(src);
  } catch {
    return null;
  }
  const run = (n: Node): number | null => {
    switch (n.t) {
      case "num":
        return n.v;
      case "ref":
        return lookup(n.name);
      case "neg": {
        const a = run(n.a);
        return a == null ? null : -a;
      }
      case "bin": {
        const a = run(n.a);
        const b = run(n.b);
        if (a == null || b == null) return null;
        if (n.op === "+") return a + b;
        if (n.op === "-") return a - b;
        if (n.op === "*") return a * b;
        return b === 0 ? null : a / b;
      }
    }
  };
  const v = run(tree);
  return v == null || !Number.isFinite(v) ? null : v;
}

/** Decimals used when a test does not set its own. */
export const DEFAULT_DECIMALS = 2;

/** A worked-out value as typed into the box: rounded to the test's decimals. */
export function formatCalculated(v: number, decimals: number | null): string {
  const d = decimals == null ? DEFAULT_DECIMALS : Math.min(6, Math.max(0, Math.trunc(decimals)));
  const s = v.toFixed(d);
  return s === "-0" || /^-0\.0*$/.test(s) ? s.slice(1) : s;
}

/** One result box on an order, as the calculation sees it. */
export interface CalcField {
  /** unique on the order, e.g. `${resultId}:${parameterId}` */
  id: string;
  /** boxes of one test share a group (its result id) */
  group: string;
  /** the test's short code */
  code: string;
  /** the value's name inside a test with several values; null for a one-value test */
  paramName: string | null;
  formula: string;
  decimals: number | null;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Which box a name in a formula means, seen from `from`: one of its own test's
 * values by name first, then a one-value test by short code, then
 * `code.Value name` for a value of another test.
 */
export function resolveRef(fields: CalcField[], from: CalcField, name: string): CalcField | null {
  const sibling = fields.find((f) => f.group === from.group && f.paramName != null && same(f.paramName, name));
  if (sibling) return sibling;
  const single = fields.find((f) => f.paramName == null && f.code && same(f.code, name));
  if (single) return single;
  const dot = name.indexOf(".");
  if (dot > 0) {
    const code = name.slice(0, dot);
    const param = name.slice(dot + 1);
    return fields.find((f) => f.code && same(f.code, code) && f.paramName != null && same(f.paramName, param)) ?? null;
  }
  return null;
}

/**
 * Fill every calculated box from the boxes it reads, in as many passes as a
 * chain needs (MCV reads PCV, which reads Hb). Boxes in `keep` (typed over by
 * hand, or locked) are read but never changed. Returns only the boxes whose
 * text changes; a box whose inputs are not all there becomes empty.
 */
export function recalculate(fields: CalcField[], values: ReadonlyMap<string, string>, keep: ReadonlySet<string>): Map<string, string> {
  const work = new Map(values);
  const changed = new Map<string, string>();
  const calc = fields.filter((f) => f.formula.trim() && !keep.has(f.id));
  for (let pass = 0; pass <= calc.length; pass++) {
    let any = false;
    for (const f of calc) {
      const v = evaluateFormula(f.formula, (name) => {
        const ref = resolveRef(fields, f, name);
        if (!ref || ref.id === f.id) return null;
        const t = (work.get(ref.id) ?? "").trim();
        return t !== "" && /^[-+]?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null;
      });
      const text = v == null ? "" : formatCalculated(v, f.decimals);
      if ((work.get(f.id) ?? "") !== text) {
        work.set(f.id, text);
        changed.set(f.id, text);
        any = true;
      }
    }
    if (!any) break;
  }
  return changed;
}

/** The text that opens a free-text box in a list of choices ("Other", "Others"). */
export function isOtherOption(option: string): boolean {
  return /^others?$/i.test(option.trim());
}
