"use client";

import { Download } from "lucide-react";
import { useSearchParams } from "next/navigation";

/** Downloads an Accounts statement as .xlsx, carrying the period on screen. */
export function ExportLink({ report, extra = {} }: { report: string; extra?: Record<string, string> }) {
  const params = useSearchParams();
  const sp = new URLSearchParams(params.toString());
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  const qs = sp.toString();
  return (
    <a
      href={`/api/accounts-export/${report}${qs ? `?${qs}` : ""}`}
      className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-line bg-cream-50 px-4 text-[14px] font-medium text-sage-900 hover:bg-cream-200"
    >
      <Download className="h-4 w-4" />
      Excel
    </a>
  );
}
