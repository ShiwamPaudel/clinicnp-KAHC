import { listFiscalYears } from "@/lib/repos/fiscal";
import { FiscalYearSelector } from "@/components/app/fiscal-year-selector";
import { ClosedYearBanner } from "@/components/app/closed-year-banner";

export interface ResolvedYear {
  label: string;
  id: number | null;
  isClosed: boolean;
}

/**
 * Resolves which fiscal year a register or report is being read in.
 * `?fy=2082/83` selects a year; no parameter means the open one.
 */
export async function resolveFiscalYear(fyParam?: string): Promise<ResolvedYear> {
  const years = await listFiscalYears();
  const open = years.find((y) => y.status === "open") ?? null;
  const picked = fyParam ? years.find((y) => y.bsLabel === fyParam) : null;
  const chosen = picked ?? open;
  return {
    label: chosen?.bsLabel ?? "",
    id: chosen?.id ?? null,
    isClosed: chosen ? chosen.status === "closed" : false,
  };
}

/**
 * Header-right selector plus the closed-year banner. Hidden entirely for
 * anybody without `reports.all` — the year filter is for those who read every
 * year (PRD §4A.1).
 */
export async function FiscalYearBar({
  canReadAllYears,
  current,
}: {
  /** `reports.all` — the year filter is for people who read every year. */
  canReadAllYears: boolean;
  current: string;
}) {
  if (!canReadAllYears) return null;
  const years = await listFiscalYears();
  if (years.length === 0) return null;

  return (
    <FiscalYearSelector
      years={years.map((y) => ({ label: y.bsLabel, status: y.status }))}
      current={current}
    />
  );
}

export { ClosedYearBanner };
