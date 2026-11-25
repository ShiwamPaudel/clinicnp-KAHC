/**
 * print-format.ts — how a printed bill and report say dates, times and money
 * in words (owner, 2083-08-08). Pure; safe on the server and in the browser.
 *
 * Times are always Nepal time, whatever clock the server runs on (a hosted
 * server runs on UTC, so `getHours()` there would print 10:15 for 4:00 PM).
 */
import { bsFromDbText, toBS, type BSDate } from "@/lib/bs";

const NEPAL_TZ = "Asia/Kathmandu";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "08-08-2083": day, month, year of a BS date. */
export function bsNumeric(bs: BSDate): string {
  return `${pad2(bs.day)}-${pad2(bs.month)}-${bs.year}`;
}

/** "08-08-2083" for a stored BS date text ("2083-08-08"). */
export function bsTextNumeric(dateBs: string): string {
  return dateBs ? bsNumeric(bsFromDbText(dateBs)) : "";
}

/** The wall clock in Nepal for an instant: its AD date and 12-hour time. */
function nepalParts(d: Date): { y: number; m: number; day: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NEPAL_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    day: Number(get("day")),
    time: `${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`,
  };
}

/** "4:00 PM", Nepal time. Empty for a missing or broken timestamp. */
export function time12(iso: string | Date | null | undefined): string {
  if (!iso) return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return nepalParts(d).time;
}

/** "08-08-2083 / 4:00 PM" for a stored timestamp, BS date in Nepal time. */
export function stampNumeric(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = nepalParts(d);
  return `${bsNumeric(toBS(new Date(p.y, p.m - 1, p.day)))} / ${p.time}`;
}

// ---------------------------------------------------------------------------
// amount in words, the Nepali way: lakh and crore, "Rupees ... Only"
// ---------------------------------------------------------------------------

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  return [TENS[Math.floor(n / 10)]!, ONES[n % 10]!].filter(Boolean).join(" ");
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** Whole rupees in words: 123456 -> "One Lakh Twenty Three Thousand Four Hundred Fifty Six". */
export function numberInWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "Zero";
  const out: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) out.push(`${numberInWords(crore)} Crore`);
  if (lakh) out.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) out.push(`${belowHundred(thousand)} Thousand`);
  if (n) out.push(belowThousand(n));
  return out.join(" ");
}

/** "Rupees Four Thousand Only", "Rupees Ten and Fifty Paisa Only". */
export function amountInWords(paisa: number): string {
  const p = Math.round(Math.abs(paisa));
  const rupees = Math.floor(p / 100);
  const ps = p % 100;
  const r = `Rupees ${numberInWords(rupees)}`;
  return ps ? `${r} and ${belowHundred(ps)} Paisa Only` : `${r} Only`;
}
