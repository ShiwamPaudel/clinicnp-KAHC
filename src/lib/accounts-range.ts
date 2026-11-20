/**
 * accounts-range.ts — the period or the day an Accounts page is showing,
 * read from its address. Pure.
 */
import { resolveRange, rangeForPreset } from "@/lib/date-range";
import { adFromIso, bsToDbText, formatBS, toBS } from "@/lib/bs";

export interface AccountsRange {
  fromIso: string;
  toIso: string;
  fromBs: string;
  toBs: string;
  label: string;
  preset?: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function bs(iso: string): string {
  return bsToDbText(toBS(adFromIso(iso)));
}

export function longBs(iso: string): string {
  return formatBS(toBS(adFromIso(iso)), { form: "long", monthScript: "en" });
}

/** A period, defaulting to this month. */
export function accountsRange(
  sp: { preset?: string; from?: string; to?: string; fy?: string },
  fallback: "month" | "fy" = "month",
): AccountsRange {
  try {
    return readRange(sp, fallback);
  } catch {
    // a date in the address the calendar cannot place: show the default period
    return readRange({}, fallback);
  }
}

function readRange(
  sp: { preset?: string; from?: string; to?: string; fy?: string },
  fallback: "month" | "fy",
): AccountsRange {
  const from = sp.from && ISO.test(sp.from) ? sp.from : undefined;
  const to = sp.to && ISO.test(sp.to) ? sp.to : undefined;
  const r =
    from && to
      ? resolveRange({ from: from <= to ? from : to, to: from <= to ? to : from })
      : sp.preset || sp.fy
        ? resolveRange({ preset: sp.preset, fy: sp.fy })
        : rangeForPreset(fallback);
  const label = from && to ? `${longBs(r.fromIso)} to ${longBs(r.toIso)}` : r.label;
  return { fromIso: r.fromIso, toIso: r.toIso, fromBs: bs(r.fromIso), toBs: bs(r.toIso), label, preset: r.preset };
}

/** One day, defaulting to today. */
export function accountsAsOf(sp: { asof?: string }): { iso: string; bs: string; label: string } {
  const today = rangeForPreset("today").toIso;
  let iso = sp.asof && ISO.test(sp.asof) ? sp.asof : today;
  try {
    bs(iso);
  } catch {
    iso = today;
  }
  return { iso, bs: bs(iso), label: iso === today ? `Today, ${longBs(iso)}` : `As on ${longBs(iso)}` };
}
