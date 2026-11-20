/**
 * lab-format.ts — how the laboratory screens say things. Pure.
 */
import { adFromIso, adToIso, bsFromDbText, formatBS, toBS } from "@/lib/bs";

/** "Mangsir 3 · 14:20" for a stored timestamp. */
export function stampAt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const bs = formatBS(toBS(adFromIso(adToIso(d))), { form: "short", monthScript: "en" });
  return `${bs} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "Mangsir 3, 2083 · 14:20" — for print, where a numeric date reads as a code. */
export function stampAtLong(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const bs = formatBS(toBS(adFromIso(adToIso(d))), { form: "long", monthScript: "en" });
  return `${bs} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "Mangsir 3, 2083" for a stored BS date text. */
export function bsDateLabel(dateBs: string): string {
  return formatBS(bsFromDbText(dateBs), { form: "long", monthScript: "en" });
}

export function patientNoLabel(no: number | null): string {
  return no == null ? "New" : `P-${String(no).padStart(6, "0")}`;
}

export function orderNoLabel(no: number): string {
  return `LAB-${String(no).padStart(6, "0")}`;
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  sample_pending: "Waiting for sample",
  in_progress: "In progress",
  result_pending: "Results being entered",
  awaiting_approval: "Waiting for approval",
  approved: "Ready to hand over",
  dispatched: "Handed over",
  cancelled: "Cancelled",
};

export const RESULT_STATUS_LABEL: Record<string, string> = {
  pending: "Not started",
  draft: "Draft",
  submitted: "Waiting for approval",
  correction_required: "Sent back",
  approved: "Approved",
  dispatched: "Handed over",
  cancelled: "Cancelled",
};

export const SAMPLE_STATUS_LABEL: Record<string, string> = {
  waiting: "To collect",
  collected: "Collected",
  rejected: "Rejected",
  recollection: "Draw again",
  cancelled: "Cancelled",
};

export type Tone = "ok" | "warn" | "danger" | "info" | "neutral";

export function orderTone(status: string): Tone {
  if (status === "approved" || status === "dispatched") return "ok";
  if (status === "awaiting_approval") return "info";
  if (status === "cancelled") return "danger";
  if (status === "sample_pending") return "warn";
  return "neutral";
}

export function resultTone(status: string): Tone {
  if (status === "approved" || status === "dispatched") return "ok";
  if (status === "submitted") return "info";
  if (status === "correction_required") return "danger";
  if (status === "draft") return "warn";
  return "neutral";
}
